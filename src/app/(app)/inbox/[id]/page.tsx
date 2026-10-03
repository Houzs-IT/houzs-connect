import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company, contactField, conversation, department, member, note, payment, tag } from "@/db/schema";
import { MarkRead } from "@/components/inbox/MarkRead";
import { Thread, type ThreadItem } from "@/components/inbox/Thread";
import { Composer } from "@/components/inbox/Composer";
import { ContactPanel, type FirstReply } from "@/components/inbox/ContactPanel";
import { ConversationMenu } from "@/components/inbox/ConversationMenu";
import { AssignButton, ResolveButton } from "@/components/inbox/HeaderActions";
import { DemoReplyBar } from "@/components/inbox/DemoReplyBar";
import { WindowTimer } from "@/components/inbox/WindowTimer";
import { getCurrentMember } from "@/lib/current-member";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { attrs, initials, stamp, tint, waIdentifier } from "@/lib/format";
import { bypassReadCache } from "@/db/fresh";
import { getDict } from "@/lib/i18n/server";
import { SLA_MINUTES } from "@/lib/sla";
import { getAutomationEvents, getAutomationProgress } from "@/lib/automation/progress";
import { ordersByRef, paymentPicklists, slipWindow } from "@/lib/erp/orders";
import type { ErpPanelData } from "@/components/inbox/ContactPanel";

/**
 * How much of the thread is rendered. WhatsApp threads with a customer run for
 * months; loading every message meant the page got slower for exactly the
 * customers the team talks to most. The tail is what operators read, so take
 * the newest N and put them back in reading order.
 */
const THREAD_LIMIT = 200;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  // The watchers are read as part of the conversation's own query below, so on a
  // deploy that lands before `pnpm db:migrate` a missing conversation_member
  // table would 500 the whole thread, not just its panel section. Swallowing the
  // error is deliberate: if the table already exists, a transient DDL failure
  // must not take the page down, and if it genuinely does not exist the query
  // right after this fails with Postgres's own message.
  await ensureConversationMemberTable(db).catch(() => {});

  const convo = await db.query.conversation.findFirst({
    // Fresh (db/fresh.ts): this page re-renders every few seconds to show a
    // customer's new message; a cached thread would hide it for a minute.
    where: and(eq(conversation.id, id), bypassReadCache()),
    with: {
      contact: true,
      assignedAgent: true,
      assignedDepartment: true,
      tagLinks: { with: { tag: true } },
      memberLinks: true,
      messages: {
        orderBy: (m, { desc }) => desc(m.createdAt),
        limit: THREAD_LIMIT,
      },
    },
  });
  // A conversation id is guessable and the list page's visibility filter does
  // not protect this route — without the company check any signed-in member
  // could read another tenant's thread, phone number and order attributes.
  if (!convo || convo.contact.companyId !== me.companyId) notFound();

  // Newest-first off the index, oldest-first on screen.
  const messages = convo.messages.slice().reverse();

  const [fields, members, departments, tags, notes, payments] = await Promise.all([
    db.query.contactField.findMany({
      where: eq(contactField.companyId, convo.contact.companyId),
      orderBy: asc(contactField.createdAt),
    }),
    // Assignment pickers must not offer another company's staff.
    db.query.member.findMany({
      where: eq(member.companyId, me.companyId),
      orderBy: asc(member.name),
    }),
    db.query.department.findMany({
      where: eq(department.companyId, me.companyId),
      orderBy: asc(department.name),
    }),
    db.query.tag.findMany({ where: eq(tag.companyId, convo.contact.companyId) }),
    // Private notes written in the composer. They were stored and never shown;
    // the thread now interleaves them with the messages.
    db.query.note.findMany({
      where: eq(note.conversationId, convo.id),
      orderBy: desc(note.createdAt),
      limit: THREAD_LIMIT,
    }),
    // Payment slips this customer sent in chat (any conversation), newest first.
    db.query.payment.findMany({
      where: eq(payment.contactId, convo.contact.id),
      orderBy: desc(payment.createdAt),
      limit: 10,
    }),
  ]);

  const name = convo.contact.name ?? convo.contact.phone;
  const contactAttrs = attrs(convo.contact.attributes);

  // Who sent each outbound message. `members` is already the company's full
  // roster for the assignment picker, so attribution costs no extra query — and
  // it still resolves staff who have since been deactivated, because the org
  // sync marks them inactive rather than deleting the row.
  const memberNames = new Map(members.map((m) => [m.id, m.name]));

  // Same roster, resolved the same way — the chat members are ids on the
  // conversation, and naming them costs nothing extra. A member row is never
  // hard-deleted (the org sync deactivates instead), so the fallback should
  // never show; it is there so one stale id cannot blank the panel.
  const chatMembers = convo.memberLinks
    .map((l) => ({
      id: l.memberId,
      name: memberNames.get(l.memberId) ?? "Unknown member",
      addedBy: l.addedByMemberId ? (memberNames.get(l.addedByMemberId) ?? null) : null,
      // stamp() is Date.now()-free, so this stays a pure render.
      addedAt: stamp(l.createdAt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Flow milestones since the oldest message on screen, and the customer's
  // current flow for the panel — both read from automation_run.
  const since = messages[0]?.createdAt ?? convo.createdAt;
  // Live ERP orders for the customer's reference (lib/erp/orders.ts, cached a
  // minute) — fetched beside the automation reads, never in front of them.
  const ref = contactAttrs.ref_1;
  const erpLoad = async (): Promise<ErpPanelData | null> => {
    if (!ref) return null;
    const co = await db.query.company.findFirst({
      where: eq(company.id, me.companyId),
      columns: { erpCompanyId: true },
    });
    const erpCo = co?.erpCompanyId ?? null;
    const [lookup, picks] = await Promise.all([ordersByRef(ref, erpCo), paymentPicklists(erpCo)]);
    return {
      ref,
      lookup,
      onlineTypes: picks?.onlineTypes ?? [],
      merchants: picks?.merchants ?? [],
      ...slipWindow(),
      preview: process.env.CONNECT_PREVIEW === "1",
    };
  };
  const [automationEvents, automation, erp] = await Promise.all([
    getAutomationEvents(convo.contact.id, since),
    getAutomationProgress(convo.contact.id),
    erpLoad(),
  ]);

  const items: ThreadItem[] = [
    ...messages.map((m) => ({
      ...m,
      kind: "message" as const,
      senderName: m.isBot
        ? "Bot"
        : m.sentByMemberId
          ? (memberNames.get(m.sentByMemberId) ?? null)
          : null,
    })),
    ...notes.map((n) => ({
      kind: "note" as const,
      id: n.id,
      body: n.body,
      author: memberNames.get(n.memberId) ?? null,
      createdAt: n.createdAt,
    })),
    ...automationEvents.map((e) => ({
      kind: "event" as const,
      id: e.id,
      event: e.kind,
      name: e.name,
      createdAt: e.at,
    })),
  ].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());

  // First reply: from the customer's first message in the loaded thread to the
  // first outbound message after it, bot or human.
  const firstIn = messages.find((m) => m.direction === "IN");
  const firstOut = firstIn
    ? messages.find((m) => m.direction === "OUT" && m.createdAt > firstIn.createdAt)
    : undefined;
  const firstReply: FirstReply =
    firstIn && firstOut
      ? (() => {
          const seconds = Math.round((firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 1000);
          return { seconds, onTime: seconds <= SLA_MINUTES * 60 };
        })()
      : null;

  const t = await getDict();
  const s = t.service;
  const ident = waIdentifier(convo.contact.phone);
  const orderRef = contactAttrs.ref_1;
  const statusTone: Record<string, string> = {
    OPEN: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    PENDING: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    QUEUE: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
    CLOSED: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  };

  return (
    <div className="flex min-w-0 flex-1">
      {/* Opening a conversation clears its unread badge. */}
      <MarkRead conversationId={convo.id} />
      {/* Center: thread */}
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
        <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 md:gap-3 md:px-4">
          {/* Back to the conversation list. On a phone the rail and the thread
              never share the screen, so this is the only way back to it; above
              md the rail is always visible and the control is hidden. */}
          <Link
            href="/inbox"
            aria-label={s.back}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-[8px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <span
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white md:h-9 md:w-9"
            style={{ background: tint(name) }}
          >
            {initials(name).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 md:flex-none">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[14.5px] font-semibold text-[var(--color-ink)]">{name}</span>
              <span className={`hidden whitespace-nowrap rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] md:inline ${statusTone[convo.status] ?? statusTone.CLOSED}`}>
                {s.statusLabel[convo.status] ?? convo.status}
              </span>
            </div>
            {/* Phone: the window as a line of text. Desktop: number · order. */}
            <div className="md:hidden">
              <WindowTimer expiresAt={convo.windowExpiresAt?.toISOString() ?? null} plain />
            </div>
            <div className="hidden truncate text-[11.5px] tabular-nums text-[var(--color-muted)] md:block" title={ident.label}>
              {ident.text}
              {orderRef && (
                <>
                  {" · "}
                  <span className="font-medium text-[var(--color-brand)]">{orderRef}</span>
                </>
              )}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Who else is in the room — the panel is hidden below xl. */}
            {chatMembers.length > 0 && (
              <div className="hidden -space-x-1.5 lg:flex" title={chatMembers.map((m) => m.name).join(", ")}>
                {chatMembers.slice(0, 3).map((m) => (
                  <span
                    key={m.id}
                    className="grid h-6 w-6 place-items-center rounded-full border border-[var(--color-surface)] text-[9px] font-semibold text-white"
                    style={{ background: tint(m.name) }}
                  >
                    {initials(m.name).toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            <div className="hidden md:block">
              <WindowTimer expiresAt={convo.windowExpiresAt?.toISOString() ?? null} />
            </div>
            <div className="hidden md:block">
              <AssignButton
                conversationId={convo.id}
                agentId={convo.assignedAgentId}
                departmentId={convo.assignedDepartmentId}
                members={members.map((m) => ({ id: m.id, name: m.name }))}
                departments={departments.map((d) => ({ id: d.id, name: d.name }))}
              />
            </div>
            <ResolveButton conversationId={convo.id} closed={convo.status === "CLOSED"} />
            {/* The panel (and its menu) is hidden below xl; keep the actions. */}
            <div className="xl:hidden">
              <ConversationMenu conversationId={convo.id} />
            </div>
          </div>
        </div>

        <Thread items={items} conversationId={convo.id} />
        {/* The DEMO simulators are for driving a flow with no real WhatsApp
            attached. On LIVE they were still rendered — a thread showing
            "LIVE · sending via WhatsApp" in the sidebar and a "Send as customer"
            box under it, whose server actions demoOnly() already refuses. An
            operator reading that can only conclude the inbox is faking traffic. */}
        {!isLive() && <DemoReplyBar conversationId={convo.id} />}
        <Composer
          conversationId={convo.id}
          // The expiry, not a boolean: comparing it to the clock is the client's
          // job, exactly as WindowTimer does it. Deciding here would both call an
          // impure function during render and freeze the answer at render time,
          // so a composer left open past the deadline would still invite a reply.
          windowExpiresAt={convo.windowExpiresAt?.toISOString() ?? null}
        />
      </div>

      {/* Right: contact + order attributes */}
      <ContactPanel
        conversationId={convo.id}
        contactName={name}
        phone={convo.contact.phone}
        agentId={convo.assignedAgentId}
        departmentId={convo.assignedDepartmentId}
        tags={convo.tagLinks.map((tl) => ({ id: tl.tag.id, name: tl.tag.name, color: tl.tag.color }))}
        fields={fields.map((f) => ({ key: f.key, name: f.name }))}
        values={contactAttrs}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        chatMembers={chatMembers}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        allTags={tags.map((tg) => ({ id: tg.id, name: tg.name, color: tg.color }))}
        marketingOptIn={convo.contact.marketingOptIn}
        contactId={convo.contact.id}
        remarks={contactAttrs.remarks ?? ""}
        email={convo.contact.email ?? ""}
        starred={contactAttrs.starred === "1"}
        firstReply={firstReply}
        payments={payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          currency: p.currency,
          method: p.method,
          referenceNo: p.referenceNo,
          status: p.status,
          createdAt: stamp(p.createdAt),
        }))}
        automation={automation}
        erp={erp}
      />
    </div>
  );
}

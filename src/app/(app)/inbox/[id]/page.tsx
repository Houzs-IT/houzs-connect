import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, conversation, department, member, tag } from "@/db/schema";
import { Thread } from "@/components/inbox/Thread";
import { Composer } from "@/components/inbox/Composer";
import { ContactPanel } from "@/components/inbox/ContactPanel";
import { DemoReplyBar } from "@/components/inbox/DemoReplyBar";
import { WindowTimer } from "@/components/inbox/WindowTimer";
import { getCurrentMember } from "@/lib/current-member";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { attrs, initials, stamp, tint, waIdentifier } from "@/lib/format";
import { bypassReadCache } from "@/db/fresh";

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

  const [fields, members, departments, tags] = await Promise.all([
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

  const thread = messages.map((m) => ({
    ...m,
    senderName: m.isBot
      ? "Bot"
      : m.sentByMemberId
        ? (memberNames.get(m.sentByMemberId) ?? null)
        : null,
  }));

  return (
    <div className="flex min-w-0 flex-1">
      {/* Center: thread */}
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: tint(name) }}
          >
            {initials(name).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">
              {name}
            </div>
            <div
              className="font-mono text-[11px] text-[var(--color-muted)]"
              title={waIdentifier(convo.contact.phone).label}
            >
              {waIdentifier(convo.contact.phone).text}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Who else is in the room. The panel is hidden below xl, so without
                this an agent on a laptop has no way to know a colleague was
                pulled in — and "someone else is watching" changes how you
                write the next reply. */}
            {chatMembers.length > 0 && (
              <div
                className="flex items-center gap-1.5"
                title={`Watching: ${chatMembers.map((m) => m.name).join(", ")}`}
              >
                <div className="flex -space-x-1.5">
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
                <span className="text-[11px] text-[var(--color-muted)]">
                  {chatMembers.length > 3
                    ? `+${chatMembers.length - 3} watching`
                    : "watching"}
                </span>
              </div>
            )}
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted)]">
              {convo.status}
            </span>
            <WindowTimer expiresAt={convo.windowExpiresAt?.toISOString() ?? null} />
          </div>
        </div>

        <Thread
          messages={thread}
          contactName={name}
          conversationId={convo.id}
        />
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
        status={convo.status}
        agentId={convo.assignedAgentId}
        departmentId={convo.assignedDepartmentId}
        tags={convo.tagLinks.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }))}
        fields={fields.map((f) => ({ key: f.key, name: f.name }))}
        values={contactAttrs}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        chatMembers={chatMembers}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        allTags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        marketingOptIn={convo.contact.marketingOptIn}
        contactId={convo.contact.id}
        remarks={contactAttrs.remarks ?? ""}
        email={convo.contact.email ?? ""}
        starred={contactAttrs.starred === "1"}
      />
    </div>
  );
}

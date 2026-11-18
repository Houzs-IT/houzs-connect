import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversation, conversationMember, tag } from "@/db/schema";
import { bypassReadCache } from "@/db/fresh";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import type { CurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { formatPhone } from "@/lib/format";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { getInboxScopes, scopeChannels, scopeLabel, unifiedConversationWhere } from "@/lib/inbox-group";

/** Status dots, in the redesign's colours. */
const STATUS_DOT: Record<string, string> = {
  OPEN: "var(--color-success)",
  PENDING: "var(--color-warning)",
  QUEUE: "var(--color-accent)",
  CLOSED: "var(--color-border-strong)",
};

/**
 * Service's secondary menu: views, status, tags and tools. Every entry is a
 * `?query` link — the conversation list reads the same params — so a filter
 * keeps the open thread open.
 *
 * Counts are real COUNTs over the same scope predicate the list uses (company
 * group + visibility, lib/inbox-group.ts), so they stay true beyond the rail's
 * first page. "All" and the views leave closed conversations out, as the list
 * does by default; closed ones are reached through Status → Closed.
 */
export async function ServiceMenu({ me }: { me: CurrentMember }) {
  const t = await getDict();
  const db = getDb();
  await ensureConversationMemberTable(db).catch(() => {});

  const scopes = await getInboxScopes();
  const scopeWhere = await unifiedConversationWhere(db, scopes);
  const companyIds = scopes.map((sc) => sc.companyId);
  // "Mine" in a unified inbox is any of the person's member rows.
  const myIds = scopes.length ? scopes.map((sc) => sc.memberId) : [me.id];
  const multi = scopes.length > 1;

  const base = (...extra: (SQL | undefined)[]) =>
    db.$count(conversation, and(scopeWhere, bypassReadCache(), ...extra));
  const active = ne(conversation.status, "CLOSED");

  const [all, mine, unassigned, watching, open, pending, queue, tags, numbers] =
    await Promise.all([
      base(active),
      base(active, inArray(conversation.assignedAgentId, myIds)),
      base(active, isNull(conversation.assignedAgentId)),
      base(
        active,
        inArray(
          conversation.id,
          db
            .select({ id: conversationMember.conversationId })
            .from(conversationMember)
            .where(inArray(conversationMember.memberId, myIds))
        )
      ),
      base(eq(conversation.status, "OPEN")),
      base(eq(conversation.status, "PENDING")),
      base(eq(conversation.status, "QUEUE")),
      companyIds.length
        ? db.query.tag.findMany({ where: inArray(tag.companyId, companyIds), orderBy: asc(tag.name) })
        : Promise.resolve([]),
      scopeChannels(db, scopes),
    ]);

  const live = process.env.WHATSAPP_MODE === "LIVE";
  const labelOf = new Map(scopes.map((sc) => [sc.companyId, scopeLabel(sc)]));
  // Default number first, then the rest — every number this inbox answers.
  const phones = [...numbers].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const coName = scopes.map((sc) => sc.companyName).filter(Boolean).join(" + ");
  const s = t.service;

  return (
    <SecondaryMenu
      title={t.nav.inbox}
      groups={[
        {
          title: s.views,
          items: [
            { href: "?", label: s.allConvos, count: all },
            { href: "?view=mine", label: s.mine, count: mine },
            { href: "?view=unassigned", label: s.unassigned, count: unassigned },
            { href: "?view=watching", label: s.watching, count: watching },
          ],
        },
        {
          title: s.status,
          items: [
            { href: "?status=OPEN", label: s.statusLabel.OPEN, count: open, dot: STATUS_DOT.OPEN },
            { href: "?status=PENDING", label: s.statusLabel.PENDING, count: pending, dot: STATUS_DOT.PENDING },
            { href: "?status=QUEUE", label: s.statusLabel.QUEUE, count: queue, dot: STATUS_DOT.QUEUE },
            { href: "?status=CLOSED", label: s.statusLabel.CLOSED, dot: STATUS_DOT.CLOSED },
          ],
        },
        ...(tags.length
          ? [
              {
                title: s.tags,
                items: tags.map((tg) => ({
                  href: `?tag=${encodeURIComponent(tg.id)}`,
                  // Two companies can each have a "Scheduling" tag; say whose.
                  label: multi ? `${tg.name} · ${labelOf.get(tg.companyId) ?? ""}` : tg.name,
                  dot: tg.color,
                })),
              },
            ]
          : []),
        {
          title: s.tools,
          items: [
            { href: "/settings", label: s.quickReplies, exact: true },
            { href: "/settings/auto-replies", label: s.autoReplies },
          ],
        },
      ]}
      footer={
        <div className="flex flex-col gap-0.5 text-[11px]">
          <div
            className={`flex items-center gap-1.5 font-semibold ${
              live ? "text-[var(--color-success)]" : "text-[var(--color-faint)]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? "bg-[var(--color-success)]" : "bg-[var(--color-faint)]"
              }`}
            />
            {live ? "LIVE · WhatsApp" : "DEMO · WhatsApp"}
          </div>
          {coName && <div className="truncate text-[var(--color-muted)]">{coName}</div>}
          {phones.map((n) => (
            <div key={n.id} className="tabular-nums text-[var(--color-faint)]">
              {formatPhone(n.phone)}
              {multi && <span className="ml-1 text-[10px]">· {labelOf.get(n.companyId)}</span>}
            </div>
          ))}
        </div>
      }
    />
  );
}

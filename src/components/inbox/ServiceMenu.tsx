import { and, asc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel, company, conversation, conversationMember, tag } from "@/db/schema";
import { bypassReadCache } from "@/db/fresh";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { conversationCompanyWhere, conversationVisibilityWhere, getVisibility } from "@/lib/access";
import type { CurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { formatPhone } from "@/lib/format";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { can } from "@/lib/permissions";

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
 * Counts are real COUNTs over the same company + visibility predicate the list
 * uses, so they stay true beyond the rail's first page. "All" and the views
 * leave closed conversations out, as the list does by default; closed ones are
 * reached through Status → Closed.
 */
export async function ServiceMenu({ me }: { me: CurrentMember }) {
  const t = await getDict();
  const db = getDb();
  const allMembers = await db.query.member.findMany({ columns: { id: true, managerId: true } });
  const vis = getVisibility(me, allMembers, await can(me, "seeAll"));
  await ensureConversationMemberTable(db).catch(() => {});

  const base = (...extra: (SQL | undefined)[]) =>
    db.$count(
      conversation,
      and(
        conversationCompanyWhere(db, me.companyId),
        conversationVisibilityWhere(vis),
        bypassReadCache(),
        ...extra
      )
    );
  const active = ne(conversation.status, "CLOSED");

  const [all, mine, unassigned, watching, open, pending, queue, tags, co, numbers] =
    await Promise.all([
      base(active),
      base(active, eq(conversation.assignedAgentId, me.id)),
      base(active, isNull(conversation.assignedAgentId)),
      base(
        active,
        inArray(
          conversation.id,
          db
            .select({ id: conversationMember.conversationId })
            .from(conversationMember)
            .where(eq(conversationMember.memberId, me.id))
        )
      ),
      base(eq(conversation.status, "OPEN")),
      base(eq(conversation.status, "PENDING")),
      base(eq(conversation.status, "QUEUE")),
      db.query.tag.findMany({ where: eq(tag.companyId, me.companyId), orderBy: asc(tag.name) }),
      db.query.company.findFirst({ where: eq(company.id, me.companyId), columns: { name: true } }),
      db.query.channel.findMany({
        where: eq(channel.companyId, me.companyId),
        columns: { phone: true, isDefault: true },
      }),
    ]);

  const live = process.env.WHATSAPP_MODE === "LIVE";
  const number = (numbers.find((n) => n.isDefault) ?? numbers[0])?.phone;
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
                  label: tg.name,
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
          {co?.name && <div className="truncate text-[var(--color-muted)]">{co.name}</div>}
          {number && <div className="tabular-nums text-[var(--color-faint)]">{formatPhone(number)}</div>}
        </div>
      }
    />
  );
}

import { notFound } from "next/navigation";
import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel, company, contactField, member, quickReply, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { formatPhone } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { SetCard, SettingsHead } from "./ui";

/** General settings: this company as Connect knows it, and what it holds. */
export default async function GeneralSettingsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const n = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0);
  const [co, ch, members, fields, tags, replies] = await Promise.all([
    db.query.company.findFirst({ where: eq(company.id, me.companyId) }),
    db.query.channel.findFirst({
      where: eq(channel.companyId, me.companyId),
      orderBy: [desc(channel.isDefault), asc(channel.displayName)],
    }),
    n(db.select({ n: count() }).from(member).where(eq(member.companyId, me.companyId))),
    n(db.select({ n: count() }).from(contactField).where(eq(contactField.companyId, me.companyId))),
    n(db.select({ n: count() }).from(tag).where(eq(tag.companyId, me.companyId))),
    n(db.select({ n: count() }).from(quickReply).where(eq(quickReply.companyId, me.companyId))),
  ]);

  const rows: [string, string][] = [
    [L.companyName, co?.name ?? "—"],
    [L.timezone, "Asia/Kuala_Lumpur"],
    [L.defaultNumber, ch ? `${ch.displayName} · ${formatPhone(ch.phone)}` : "—"],
  ];
  const glance: [string, number, string][] = [
    [L.members, members, "blue"],
    [L.fields, fields, "cyan"],
    [L.tags, tags, "purple"],
    [L.quickReplies, replies, "orange"],
  ];

  return (
    <PageChrome section="settings" page="general">
      <div className="max-w-[1000px] p-4 md:p-6">
        <SettingsHead title={L.general} sub={L.generalSub} />
        <div className="flex flex-col gap-4">
          <SetCard icon="▤" tone="blue" title={co?.name ?? L.general} sub={L.fromErp}>
            <dl className="grid border-t border-[var(--color-border-subtle)] md:grid-cols-3">
              {rows.map(([k, v]) => (
                <div key={k} className="border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-r-0 md:border-b-0 md:border-r">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{k}</dt>
                  <dd className="mt-1 text-[13.5px] text-[var(--color-ink)]">{v}</dd>
                </div>
              ))}
            </dl>
          </SetCard>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.atAGlance}</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {glance.map(([k, v, tone]) => (
                <div
                  key={k}
                  className="rounded-[12px] border border-[var(--color-border)] px-4 py-3"
                  style={{ background: `linear-gradient(135deg,#ffffff 45%, var(--color-pastel-${tone}))` }}
                >
                  <div className="text-[12px] text-[var(--color-muted)]">{k}</div>
                  <div className="mt-1 text-[22px] font-medium tabular-nums text-[var(--color-ink)]">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}

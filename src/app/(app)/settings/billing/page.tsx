import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel, member } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { monthSpend } from "@/lib/whatsapp/spend";
import { SetCard, SettingsHead } from "../ui";

export const dynamic = "force-dynamic";

const BAR: Record<string, string> = {
  MARKETING: "var(--color-pastel-pink-ink)",
  UTILITY: "var(--color-pastel-blue-ink)",
  AUTHENTICATION: "var(--color-pastel-purple-ink)",
  SERVICE: "var(--color-pastel-green-ink)",
};

/** Usage in Connect, and what Meta charged this month by category. */
export default async function BillingPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const n = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0);
  const [seats, numbers, spend] = await Promise.all([
    n(db.select({ n: count() }).from(member).where(eq(member.companyId, me.companyId))),
    n(db.select({ n: count() }).from(channel).where(eq(channel.companyId, me.companyId))),
    monthSpend(),
  ]);
  const max = spend.ok ? Math.max(1, ...spend.rows.map((r) => r.cost)) : 1;
  const money = (v: number, cur: string) => `${cur === "MYR" ? "RM" : cur} ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <PageChrome section="settings" crumbs={[L.billing]}>
      <div className="flex max-w-[1180px] flex-col gap-4 p-4 md:p-6">
        <SettingsHead title={L.billing} sub={L.billingSub} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SetCard icon="RM" tone="green" title={L.usage} sub={L.usageSub}>
            {[
              [L.seats, seats],
              [L.numbersL, numbers],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-4 py-3.5">
                <span className="text-[13.5px] text-[var(--color-ink)]">{k}</span>
                <span className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">{v}</span>
              </div>
            ))}
          </SetCard>

          <SetCard icon="◔" tone="orange" title={L.spend} sub={L.spendSub}>
            {!spend.ok ? (
              <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[12.5px] text-[var(--color-danger)]">{fmt(L.spendErr, { e: spend.error })}</p>
            ) : spend.rows.length === 0 ? (
              <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[12.5px] text-[var(--color-faint)]">{L.noSpend}</p>
            ) : (
              <>
                {spend.rows.map((r) => (
                  <div key={r.category} className="flex items-center gap-4 border-t border-[var(--color-border-subtle)] px-4 py-3">
                    <div className="w-[120px] shrink-0">
                      <div className="text-[13.5px] text-[var(--color-ink)]">{L.cat[r.category] ?? r.category}</div>
                      <div className="text-[11px] text-[var(--color-faint)]">{fmt(L.msgs, { n: r.volume.toLocaleString("en-US") })}</div>
                    </div>
                    <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-dim)]">
                      <div className="h-full rounded-full" style={{ width: `${(r.cost / max) * 100}%`, background: BAR[r.category] ?? "var(--color-accent)" }} />
                    </div>
                    <span className="w-[96px] text-right text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{money(r.cost, spend.currency)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5">
                  <span className="text-[12.5px] font-semibold text-[var(--color-muted)]">{L.total}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums text-[var(--color-ink)]">
                    {money(spend.rows.reduce((a, r) => a + r.cost, 0), spend.currency)}
                  </span>
                </div>
              </>
            )}
          </SetCard>
        </div>

        <SetCard
          icon="▤"
          tone="blue"
          title={L.invoices}
          right={
            <a
              href="https://business.facebook.com/billing_hub"
              target="_blank"
              rel="noopener noreferrer"
              className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 py-[7px] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              {L.openBilling} ↗
            </a>
          }
        >
          <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[13px] text-[var(--color-muted)]">{L.invoicesBody}</p>
        </SetCard>
      </div>
    </PageChrome>
  );
}

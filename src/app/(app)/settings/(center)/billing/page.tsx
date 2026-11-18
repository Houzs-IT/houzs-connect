import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { FilterPill } from "@/components/shell/FilterPill";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { isAdminRole } from "@/lib/permissions";
import { sumCost, sumVolume } from "@/lib/whatsapp/spend";
import { SetCard, SettingsHead } from "../ui";
import { loadBilling, pickMonth } from "@/lib/billing";

export const dynamic = "force-dynamic";

const BAR: Record<string, string> = {
  MARKETING: "var(--color-pastel-pink-ink)",
  UTILITY: "var(--color-pastel-blue-ink)",
  AUTHENTICATION: "var(--color-pastel-purple-ink)",
  SERVICE: "var(--color-pastel-green-ink)",
};

const th = "px-4 py-2.5 text-[11.5px] font-semibold text-[var(--color-muted)]";
const td = "border-t border-[var(--color-border-subtle)] px-4 py-3 text-[13px] tabular-nums text-[var(--color-ink)]";

/** This company's usage and Meta charges for a month; admins also get every company's, to bill back. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const { month, months } = pickMonth((await searchParams).month);
  const { bill, companies } = await loadBilling(month);
  const admin = isAdminRole(me.role);
  const mine = companies.find((c) => c.id === me.companyId);
  const rows = mine?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.cost));
  const currency = bill.ok ? bill.currency : "";
  const money = (v: number) => `${currency === "MYR" ? "RM" : currency} ${v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nameOf = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
  const billed = [...companies].sort((a, b) => sumCost(b.rows) - sumCost(a.rows));

  return (
    <PageChrome section="settings" crumbs={[L.billing]}>
      <div className="flex max-w-[1180px] flex-col gap-4 p-4 md:p-6">
        <SettingsHead title={L.billing} sub={L.billingSub} />
        <div>
          <FilterPill param="month" label={L.month} anyLabel={L.monthNow} options={months.map((m) => ({ value: m, label: nameOf(m) }))} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SetCard icon="RM" tone="green" title={L.usage} sub={L.usageSub}>
            {[
              [L.seats, mine?.seats ?? 0],
              [L.numbersL, mine?.numbers.length ?? 0],
              [L.colSent, mine?.sent ?? 0],
              [L.colReceived, mine?.received ?? 0],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-4 py-3.5">
                <span className="text-[13.5px] text-[var(--color-ink)]">{k}</span>
                <span className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">{v.toLocaleString("en-US")}</span>
              </div>
            ))}
          </SetCard>

          <SetCard icon="◔" tone="orange" title={fmt(L.spendFor, { m: nameOf(month) })} sub={L.spendSub}>
            {!bill.ok ? (
              <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[12.5px] text-[var(--color-danger)]">{fmt(L.spendErr, { e: bill.error })}</p>
            ) : rows.length === 0 ? (
              <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[12.5px] text-[var(--color-faint)]">{L.noSpend}</p>
            ) : (
              <>
                {rows.map((r) => (
                  <div key={r.category} className="flex items-center gap-4 border-t border-[var(--color-border-subtle)] px-4 py-3">
                    <div className="w-[120px] shrink-0">
                      <div className="text-[13.5px] text-[var(--color-ink)]">{L.cat[r.category] ?? r.category}</div>
                      <div className="text-[11px] text-[var(--color-faint)]">{fmt(L.msgs, { n: r.volume.toLocaleString("en-US") })}</div>
                    </div>
                    <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-dim)]">
                      <div className="h-full rounded-full" style={{ width: `${(r.cost / max) * 100}%`, background: BAR[r.category] ?? "var(--color-accent)" }} />
                    </div>
                    <span className="w-[96px] text-right text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{money(r.cost)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5">
                  <span className="text-[12.5px] font-semibold text-[var(--color-muted)]">{L.total}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums text-[var(--color-ink)]">{money(sumCost(rows))}</span>
                </div>
              </>
            )}
          </SetCard>
        </div>

        {admin && (
          <SetCard
            icon="⇄"
            tone="purple"
            title={fmt(L.billBack, { m: nameOf(month) })}
            sub={L.billBackSub}
            right={
              bill.ok && (
                <a
                  href={`/settings/billing/export?month=${month}`}
                  className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 py-[7px] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                  {L.exportCsv}
                </a>
              )
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-t border-[var(--color-border-subtle)] text-right">
                    <th className={`${th} text-left`}>{L.colCompany}</th>
                    <th className={th}>{L.numbersL}</th>
                    <th className={th}>{L.seats}</th>
                    <th className={th}>{L.colSent}</th>
                    <th className={th}>{L.colReceived}</th>
                    <th className={th}>{L.colCharged}</th>
                    <th className={th}>{L.colCost}</th>
                  </tr>
                </thead>
                <tbody>
                  {billed.map((c) => (
                    <tr key={c.id} className="text-right">
                      <td className={`${td} text-left font-semibold`}>{c.name}</td>
                      <td className={td}>{c.numbers.length}</td>
                      <td className={td}>{c.seats.toLocaleString("en-US")}</td>
                      <td className={td}>{c.sent.toLocaleString("en-US")}</td>
                      <td className={td}>{c.received.toLocaleString("en-US")}</td>
                      <td className={td}>{bill.ok ? sumVolume(c.rows).toLocaleString("en-US") : "–"}</td>
                      <td className={`${td} font-semibold`}>{bill.ok ? money(sumCost(c.rows)) : "–"}</td>
                    </tr>
                  ))}
                  {bill.ok && bill.unassigned.length > 0 && (
                    <tr className="text-right">
                      <td className={`${td} text-left text-[var(--color-danger)]`} colSpan={5}>{L.unassigned}</td>
                      <td className={td}>{sumVolume(bill.unassigned).toLocaleString("en-US")}</td>
                      <td className={`${td} font-semibold text-[var(--color-danger)]`}>{money(sumCost(bill.unassigned))}</td>
                    </tr>
                  )}
                  {bill.ok && (
                    <tr className="bg-[var(--color-surface-2)] text-right">
                      <td className={`${td} text-left font-semibold`} colSpan={5}>{L.total}</td>
                      <td className={td}>{sumVolume(bill.total).toLocaleString("en-US")}</td>
                      <td className={`${td} font-semibold`}>{money(sumCost(bill.total))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SetCard>
        )}

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

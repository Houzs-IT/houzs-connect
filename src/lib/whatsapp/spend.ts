// What Meta charged this WhatsApp Business Account in a month, per number and
// category, so each company's share can be billed back to it.
//
// One account carries several companies' numbers, so the account total is no
// company's bill. Each number is asked for separately with the phone_numbers
// filter, and the account is asked once with no filter: whatever the numbers do
// not add up to is reported as unassigned, so the bill always reconciles to what
// Meta charged instead of quietly losing money.
//
// A month is asked for DAILY and added up: Meta answers MONTHLY only for a window
// of whole months ("You must [use a full month] time window to get monthly
// granularity data"). Meta calls COST approximate, and looks back one year at most.
//
// Any refusal fails the whole bill and passes the error through, so the page can
// say so instead of showing zeros or a part of the month's charges. A token
// without whatsapp_business_management is refused here.
//
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics

import { graph } from "./graph";

const GRAPH = "https://graph.facebook.com/v23.0";
const TZ = "Asia/Kuala_Lumpur";
/** Under half a sen is float noise from adding up the days, not a charge. */
const NOISE = 0.005;

export type SpendRow = { category: string; cost: number; volume: number };
export type NumberSpend = { phone: string; rows: SpendRow[] };
export type Bill =
  | { ok: true; currency: string; total: SpendRow[]; numbers: NumberSpend[]; unassigned: SpendRow[] }
  | { ok: false; error: string };

type Point = { pricing_category?: string; cost?: number; volume?: number };

export const sumCost = (rows: SpendRow[]) => rows.reduce((a, r) => a + r.cost, 0);
export const sumVolume = (rows: SpendRow[]) => rows.reduce((a, r) => a + r.volume, 0);

/** The current month and the ones before it, newest first, as YYYY-MM (Malaysia time). */
export function recentMonths(n: number, now = Date.now()): string[] {
  const [y, m] = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Unix seconds for a Malaysia-time month; the current month stops at now. */
export function monthWindow(ym: string, now = Date.now()): { start: number; end: number } {
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const nextYm = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  const at = (v: string) => Math.floor(new Date(`${v}-01T00:00:00+08:00`).getTime() / 1000);
  return { start: at(ym), end: Math.min(at(nextYm), Math.floor(now / 1000)) };
}

/** Meta's points added up per category, biggest charge first. */
export function tally(points: Point[]): SpendRow[] {
  const by = new Map<string, { cost: number; volume: number }>();
  for (const p of points) {
    const k = (p.pricing_category ?? "OTHER").toUpperCase();
    const x = by.get(k) ?? { cost: 0, volume: 0 };
    x.cost += Number(p.cost ?? 0);
    x.volume += Number(p.volume ?? 0);
    by.set(k, x);
  }
  return [...by.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.cost - a.cost);
}

/** Several numbers' rows as one, per category. */
export function addRows(lists: SpendRow[][]): SpendRow[] {
  return tally(lists.flat().map((r) => ({ pricing_category: r.category, cost: r.cost, volume: r.volume })));
}

/** What the account was charged beyond the numbers we asked about. */
export function unassignedRows(total: SpendRow[], numbers: NumberSpend[]): SpendRow[] {
  const known = new Map(addRows(numbers.map((n) => n.rows)).map((r) => [r.category, r]));
  return total
    .map((t) => {
      const k = known.get(t.category);
      return { category: t.category, cost: t.cost - (k?.cost ?? 0), volume: t.volume - (k?.volume ?? 0) };
    })
    .filter((r) => r.cost >= NOISE || r.volume > 0);
}

/** The month's bill. `phones` are the numbers companies hold, digits only as on a channel. */
export async function monthBill(cfg: { wabaId: string; token: string }, phones: string[], ym: string, now = Date.now()): Promise<Bill> {
  const { start, end } = monthWindow(ym, now);
  const ask = (filter: string) =>
    graph<{ pricing_analytics?: { data?: { data_points?: Point[] }[] } }>(
      `${GRAPH}/${cfg.wabaId}?fields=pricing_analytics.start(${start}).end(${end}).granularity(DAILY)${filter}.dimensions(["PRICING_CATEGORY"]).metric_types(["COST","VOLUME"])`,
      cfg.token
    );
  const unique = [...new Set(phones.map((p) => p.replace(/\D/g, "")).filter(Boolean))];
  const [cur, whole, ...each] = await Promise.all([
    graph<{ currency?: string }>(`${GRAPH}/${cfg.wabaId}?fields=currency`, cfg.token),
    ask(""),
    ...unique.map((p) => ask(`.phone_numbers(["${p}"])`)),
  ]);
  if (!cur.ok) return { ok: false, error: cur.error };
  if (!whole.ok) return { ok: false, error: whole.error };
  const numbers: NumberSpend[] = [];
  for (const [i, r] of each.entries()) {
    if (!r.ok) return { ok: false, error: r.error };
    numbers.push({ phone: unique[i], rows: tally(r.data.pricing_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? []) });
  }
  const total = tally(whole.data.pricing_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? []);
  return { ok: true, currency: cur.data.currency ?? "USD", total, numbers, unassigned: unassignedRows(total, numbers) };
}

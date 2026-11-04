// Pure smoke for the WhatsApp bill-back (no DB, no network: fetch is stubbed).
//
// Pins the decisions in src/lib/whatsapp/spend.ts that a company's bill rests on:
//   - each number is asked for with its own phone_numbers filter
//   - charges on a number no company holds are reported, never dropped
//   - a refusal on any one number fails the bill, never a part-bill
//   - month windows are Malaysia time and the current month stops at now
//
// Runs under tsx (same hooks as smoke-org-sync.mjs) so it imports the real .ts.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { monthBill, monthWindow, recentMonths, sumCost } = await import("../src/lib/whatsapp/spend.ts");

const HOUZS = "601111108822";
const HOOKKA = "60183107133";
const NOW = Date.parse("2026-11-03T02:00:00Z");
const cfg = { wabaId: "waba", token: "t" };

const point = (pricing_category, cost, volume) => ({ pricing_category, cost, volume });
const answer = (points) => ({ pricing_analytics: { data: [{ data_points: points }] } });

function stub(byFilter, refuse) {
  const urls = [];
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    urls.push(u);
    if (u.includes("fields=currency")) return new Response(JSON.stringify({ currency: "MYR" }));
    const phone = u.match(/phone_numbers\(\["(\d+)"\]\)/)?.[1] ?? "whole";
    if (phone === refuse) return new Response(JSON.stringify({ error: { message: "refused" } }), { status: 400 });
    return new Response(JSON.stringify(answer(byFilter[phone] ?? [])));
  };
  return urls;
}

// Two companies' numbers, plus a third number on the account nobody holds.
const urls = stub({
  whole: [point("MARKETING", 100, 10), point("MARKETING", 50, 5), point("UTILITY", 20, 40), point("SERVICE", 0, 7)],
  [HOUZS]: [point("MARKETING", 90, 9), point("UTILITY", 20, 40)],
  [HOOKKA]: [point("MARKETING", 40, 4)],
});
const bill = await monthBill(cfg, [HOUZS, "+60 18-310 7133", HOUZS], "2026-11", NOW);
assert(bill.ok, "bill should succeed");
assert(bill.currency === "MYR", "currency comes from the account");
assert(urls.filter((u) => u.includes("phone_numbers")).length === 2, "a repeated or formatted number is asked for once");
assert(bill.numbers.find((n) => n.phone === HOOKKA), "a formatted number is reduced to digits");
assert(sumCost(bill.numbers.find((n) => n.phone === HOUZS).rows) === 110, "Houzs pays only for its own number");
assert(sumCost(bill.numbers.find((n) => n.phone === HOOKKA).rows) === 40, "Hookka pays only for its own number");
assert(sumCost(bill.total) === 170, "the account total adds up the days");
assert(sumCost(bill.unassigned) === 20, "money on a number nobody holds is reported");
assert(bill.unassigned.find((r) => r.category === "SERVICE")?.volume === 7, "free messages on it are reported too");
assert(
  sumCost(bill.numbers.flatMap((n) => n.rows)) + sumCost(bill.unassigned) === sumCost(bill.total),
  "the bill reconciles to what Meta charged"
);

// Everything assigned: nothing left over, and adding-up noise is not a charge.
stub({ whole: [point("MARKETING", 0.1 + 0.2, 2)], [HOUZS]: [point("MARKETING", 0.3, 2)] });
const clean = await monthBill(cfg, [HOUZS], "2026-11", NOW);
assert(clean.ok && clean.unassigned.length === 0, "float noise must not show as unassigned money");

// One refusal fails the whole bill.
stub({ whole: [point("MARKETING", 10, 1)], [HOUZS]: [point("MARKETING", 10, 1)] }, HOOKKA);
const refused = await monthBill(cfg, [HOUZS, HOOKKA], "2026-11", NOW);
assert(!refused.ok && refused.error === "refused", "a refused number must fail the bill and carry Meta's words");

// Windows.
const iso = (s) => new Date(s * 1000).toISOString();
const oct = monthWindow("2026-10", NOW);
assert(iso(oct.start) === "2026-09-30T16:00:00.000Z", "a month starts at Malaysia midnight");
assert(iso(oct.end) === "2026-10-31T16:00:00.000Z", "a past month ends where the next starts");
const dec = monthWindow("2026-12", Date.parse("2026-12-15T00:00:00Z"));
assert(iso(dec.end) === "2026-12-15T00:00:00.000Z", "the current month stops at now");
assert(monthWindow("2026-12", Date.parse("2027-02-01T00:00:00Z")).end === Date.parse("2026-12-31T16:00:00Z") / 1000, "December rolls into January");
const months = recentMonths(3, Date.parse("2027-01-31T17:00:00Z"));
assert(months.join() === "2027-02,2027-01,2026-12", "the month turns over in Malaysia time");

console.log("smoke-spend: OK");

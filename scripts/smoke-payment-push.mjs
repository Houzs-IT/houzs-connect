// Pure smoke for the Connect -> ERP payment push core (no DB, no network).
//
// Pins src/lib/sync/erp-payments-core.ts: the body it builds for
// POST /api/connect/payments and how it reads the response. These are the exact
// contract rules — a regression here sends the ERP a wrong/incomplete payment, or
// retries one it should surface for a human (or gives up on a transient one).
//
// Runs under tsx (same hooks as smoke-org-sync.mjs) so it imports the real .ts.
// The core module imports nothing with runtime side effects, so no Worker / API.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { buildPaymentBody, interpretErpResponse, resolveMethod, normalizeCurrency, mapBankToErpCode, mapOnlineType, MAX_SLIP_BYTES } =
  await import("../src/lib/sync/erp-payments-core.ts");

const slip = { base64: "AAAA", mime: "image/jpeg", bytes: 1024 };
const base = {
  paymentId: "pay_1",
  erpCompanyId: 2,
  orderRef: "SO-2990-1001",
  amount: 4600,
  currency: "MYR",
  storedMethod: "Maybank",
  reference: "073496",
  reading: null,
  slip,
  paidAtFallback: "2026-11-03",
  customerPhone: "60123456789",
  customerName: "Ali",
};

// ── normalizeCurrency ───────────────────────────────────────────────
assert(normalizeCurrency("MYR") === "MYR", "MYR kept");
assert(normalizeCurrency("rm") === "RM", "rm -> RM (upper)");
assert(normalizeCurrency("USD") === undefined, "USD dropped");
assert(normalizeCurrency(null) === undefined, "null currency dropped");

// ── resolveMethod ───────────────────────────────────────────────────
const cardReading = { method: "Card", bank: "Public Bank", installmentMonths: 0, approvalCode: "073496", onlineType: null, paidAt: "2026-06-22" };
const online = resolveMethod({ method: "Online", onlineType: "DuitNow", bank: null }, null);
assert(online?.method === "Online" && online.onlineType === "DuitNow", "reading Online -> DuitNow");
const card = resolveMethod(cardReading, null);
assert(card?.method === "Card" && card.bank === "Public Bank" && card.installmentMonths === 0, "reading Card -> bank + One Shot");
assert(resolveMethod({ method: "Cash" }, null)?.method === "Cash", "reading Cash");
assert(resolveMethod(null, "Cash")?.method === "Cash", "stored 'Cash' -> Cash");
assert(resolveMethod(null, "DuitNow")?.method === "Online", "stored 'DuitNow' -> Online");
assert(resolveMethod(null, "Maybank")?.method === "Card", "stored bank name -> Card (intake only stores a bank for a card slip)");
assert(resolveMethod(null, "something weird") === null, "unknown stored method -> null (block)");
assert(resolveMethod(null, "") === null, "empty stored method -> null");

// ── bank / online_type → ERP codes (per company) ────────────────────
assert(mapBankToErpCode("Maybank", 1) === "MBB", "co1 Maybank -> MBB");
assert(mapBankToErpCode("Maybank", 2) === "MBB", "co2 Maybank -> MBB");
assert(mapBankToErpCode("MBB", 1) === "MBB", "host code MBB -> MBB");
assert(mapBankToErpCode("Public Bank", 1) === "Public", "co1 Public Bank -> Public");
assert(mapBankToErpCode("Public Bank", 2) === "PBB", "co2 Public Bank -> PBB");
assert(mapBankToErpCode("Hong Leong", 1) === "HLB", "co1 Hong Leong -> HLB");
assert(mapBankToErpCode("CIMB", 1) === "CIMB", "co1 CIMB");
assert(mapBankToErpCode("AEON", 1) === "AEON", "co1 AEON");
assert(mapBankToErpCode("GHL", 2) === "GHL", "co2 GHL");
// Known bank the company doesn't offer -> sent as-is so the ERP queues it (never guessed).
assert(mapBankToErpCode("CIMB", 2) === "CIMB", "co2 has no CIMB -> as-is");
assert(mapBankToErpCode("Some Random Bank", 1) === "Some Random Bank", "unknown bank -> as-is");
assert(mapBankToErpCode("", 1) === undefined, "empty bank -> undefined");

assert(mapOnlineType("DuitNow", 1) === "DuitNow", "co1 DuitNow");
assert(mapOnlineType("bank transfer", 1) === "Bank Transfer", "case-normalized to the live value");
assert(mapOnlineType("DuitNow", 2) === "DuitNow", "co2 has no DuitNow -> as-is (needs_manual)");
assert(mapOnlineType("", 1) === undefined, "empty online_type -> undefined");

// ── buildPaymentBody: the happy paths ───────────────────────────────
const b1 = buildPaymentBody(base);
assert(b1.ok, "base builds");
assert(b1.body.connect_payment_id === "pay_1", "connect_payment_id");
assert(b1.body.erp_company_id === 2, "erp_company_id");
assert(b1.body.order_ref === "SO-2990-1001", "order_ref");
assert(b1.body.amount === 4600, "amount");
assert(b1.body.method === "Card", "stored bank -> Card method");
assert(b1.body.bank === "MBB", "Maybank mapped to ERP code MBB (co2)");
assert(b1.body.approval_code === "073496", "approval_code from reference for a card");
assert(b1.body.slip_base64 === "AAAA" && b1.body.slip_mime === "image/jpeg", "slip passthrough");
assert(b1.body.currency === "MYR", "currency MYR");
assert(b1.body.customer_phone === "60123456789" && b1.body.customer_name === "Ali", "customer fields");
assert(b1.body.paid_at === "2026-11-03", "paid_at falls back to createdAt when no reading");

// paid_at prefers the slip's printed date from the reading.
const b2 = buildPaymentBody({ ...base, reading: cardReading });
assert(b2.ok && b2.body.paid_at === "2026-06-22", "paid_at prefers the reading's slip date");
assert(b2.ok && b2.body.installment_months === 0, "installment 0 (One Shot) is sent, not omitted");
assert(b2.ok && b2.body.bank === "PBB", "co2 Public Bank mapped to PBB in the body");

// Online with its sub-type + reference.
const b3 = buildPaymentBody({
  ...base,
  storedMethod: "DuitNow",
  reference: "TXN-99",
  reading: { method: "Online", onlineType: "DuitNow", bank: null, paidAt: "2026-10-01" },
});
assert(b3.ok && b3.body.method === "Online" && b3.body.online_type === "DuitNow", "Online + online_type");
assert(b3.ok && b3.body.reference === "TXN-99" && b3.body.installment_months === undefined, "Online reference, no installment");

// ── buildPaymentBody: the BLOCK paths (payload problems, no blind retry) ──
assert(!buildPaymentBody({ ...base, erpCompanyId: null }).ok, "unmapped company blocks");
assert(!buildPaymentBody({ ...base, orderRef: "  " }).ok, "missing order_ref blocks");
assert(!buildPaymentBody({ ...base, amount: 0 }).ok, "zero amount blocks");
assert(!buildPaymentBody({ ...base, amount: -5 }).ok, "negative amount blocks");
assert(!buildPaymentBody({ ...base, amount: null }).ok, "null amount blocks");
assert(!buildPaymentBody({ ...base, slip: null }).ok, "no slip blocks");
assert(!buildPaymentBody({ ...base, slip: { base64: "x", mime: "image/gif", bytes: 10 } }).ok, "gif slip blocks");
assert(!buildPaymentBody({ ...base, slip: { base64: "x", mime: "image/jpeg", bytes: MAX_SLIP_BYTES + 1 } }).ok, "oversized slip blocks");
assert(!buildPaymentBody({ ...base, storedMethod: "???", reading: null }).ok, "unknown method blocks");
assert(!buildPaymentBody({ ...base, paidAtFallback: "not-a-date", reading: null }).ok, "no usable date blocks");
// A pdf slip is accepted.
assert(buildPaymentBody({ ...base, slip: { base64: "x", mime: "application/pdf", bytes: 10 } }).ok, "pdf slip accepted");

// ── interpretErpResponse: by the body's `status`, not just the HTTP code ──
const recorded = interpretErpResponse(200, { ok: true, status: "recorded", erp_payment_ref: "RCPT-1", so_no: "SO-1" });
assert(recorded.kind === "synced" && recorded.erpPaymentRef === "RCPT-1" && recorded.soNo === "SO-1", "200 recorded -> synced + refs");
const manual = interpretErpResponse(202, { ok: true, status: "needs_manual", reason: "no match" });
assert(manual.kind === "synced" && manual.erpStatus === "needs_manual", "202 needs_manual -> synced (queued for a human)");
const idem = interpretErpResponse(200, { ok: true, status: "recorded", idempotent: true });
assert(idem.kind === "synced" && idem.idempotent === true, "idempotent:true -> synced");
assert(interpretErpResponse(400, { ok: false, error: "bad order_ref", reason: "order_ref" }).kind === "blocked", "400 -> blocked");
assert(interpretErpResponse(401, null).kind === "blocked", "401 -> blocked");
assert(interpretErpResponse(409, { status: "processing" }).kind === "pending", "409 processing -> pending (retry)");
assert(interpretErpResponse(502, null).kind === "pending", "502 -> pending (retry)");
assert(interpretErpResponse(503, null).kind === "pending", "503 -> pending (retry)");
assert(interpretErpResponse(404, null).kind === "pending", "404 (endpoint not merged yet) -> pending (retry)");
// A 200 that nonetheless says ok:false is a payload problem, not a success.
assert(interpretErpResponse(200, { ok: false, reason: "weird" }).kind === "blocked", "200 ok:false -> blocked");

console.log("smoke-payment-push: all assertions passed");

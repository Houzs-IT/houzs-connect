// Pure core of the Connect -> ERP payment push: build the request body and read
// the response. No IO, no imports with runtime side effects (only a type), so it
// is deterministic and unit-testable (scripts/smoke-payment-push.mjs). The IO
// shell — slip download, the ERP call over the Service Binding, and the sync-state
// column — lives in ./erp-payments.ts, which imports everything here.

import type { ReceiptReading } from "@/lib/receipt-vision";

const DIGITS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The ERP rejects anything else; decoded slip size is capped too. */
export const ALLOWED_SLIP_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_SLIP_BYTES = 20 * 1024 * 1024;

export type PayMethod = "Card" | "Online" | "Cash";
export type SlipMime = (typeof ALLOWED_SLIP_MIME)[number];

/** The JSON body POSTed to {ERP base}/api/connect/payments. */
export interface ErpPaymentBody {
  connect_payment_id: string;
  erp_company_id: number;
  order_ref: string;
  amount: number;
  method: PayMethod;
  paid_at: string; // YYYY-MM-DD
  slip_base64: string;
  slip_mime: SlipMime;
  customer_phone?: string;
  customer_name?: string;
  currency?: "MYR" | "RM";
  bank?: string;
  online_type?: string;
  installment_months?: number;
  approval_code?: string;
  reference?: string;
}

/** What is kept on the payment row (raw erp_sync jsonb) about the push. */
export interface ErpSyncState {
  /** PENDING = queued / retryable transient; SYNCED = recorded (or needs_manual,
   *  or idempotent); BLOCKED = payload / auth / missing-slip, needs a human, no retry. */
  status: "PENDING" | "SYNCED" | "BLOCKED";
  attempts: number;
  lastAttemptAt: string;
  syncedAt?: string | null;
  erpPaymentRef?: string | null;
  soNo?: string | null;
  /** The ERP's own status word ("recorded" | "needs_manual" | "processing"). */
  erpStatus?: string | null;
  /** Why it is BLOCKED, or the last transient reason while PENDING. */
  reason?: string | null;
}

/** Currency the ERP accepts, or undefined to omit the optional field. */
export function normalizeCurrency(cur: string | null | undefined): "MYR" | "RM" | undefined {
  const c = (cur ?? "").trim().toUpperCase();
  return c === "MYR" || c === "RM" ? c : undefined;
}

export interface ResolvedMethod {
  method: PayMethod;
  bank?: string;
  onlineType?: string;
  installmentMonths?: number;
  approvalCode?: string;
}

// NOTE: no bare "bank" alternative — it would match inside a bank NAME
// ("Maybank", "Public Bank") and mis-read a card slip as Online. "transfer"
// already catches "Bank Transfer".
const ONLINE_WORDS: [RegExp, string][] = [
  [/duit\s?now/i, "DuitNow"],
  [/\b(tng|touch\s?'?n\s?go|touchngo)\b/i, "TNG"],
  [/cheque|cek/i, "Cheque"],
  [/transfer|ibg|fpx|\bonline\b/i, "Bank Transfer"],
];

/**
 * The method breakdown the ERP wants. Prefer the fresh slip reading (the ERP's
 * own rules); when vision is unavailable, make a best effort from the conflated
 * `method` string Connect stored at intake (a known online word -> Online; "cash"
 * -> Cash; a bare bank name, which intake only ever stored for a card slip -> Card).
 * Returns null when it genuinely cannot tell — the caller then BLOCKS for a human.
 */
export function resolveMethod(reading: ReceiptReading | null, storedMethod: string | null): ResolvedMethod | null {
  if (reading && reading.method) {
    const m = reading.method;
    if (m === "Card")
      return {
        method: "Card",
        bank: reading.bank ?? undefined,
        installmentMonths: reading.installmentMonths ?? undefined,
        approvalCode: reading.approvalCode ?? undefined,
      };
    if (m === "Online")
      return {
        method: "Online",
        onlineType: reading.onlineType ?? undefined,
        bank: reading.bank ?? undefined,
        approvalCode: reading.approvalCode ?? undefined,
      };
    return { method: "Cash" };
  }

  const s = (storedMethod ?? "").trim();
  if (!s) return null;
  if (/^cash$/i.test(s)) return { method: "Cash" };
  for (const [re, type] of ONLINE_WORDS) if (re.test(s)) return { method: "Online", onlineType: type };
  if (/maybank|cimb|public\s?bank|hong\s?leong|hlb|rhb|ambank|aeon|bank\s?islam|affin|ocbc|uob|hsbc|standard\s?chartered/i.test(s))
    return { method: "Card", bank: s };
  return null;
}

// ─────────────────────────── Bank / online_type → ERP codes ───────────────────────────
// The ERP stores SHORT CODES for the acquirer bank (payment_merchant) and the
// online sub-type (online_type), per company, and it will NOT guess: a value that
// is not in the company's live list is (correctly) routed to needs_manual. Connect
// reads a brand/host name off the slip ("Maybank", or the host code "MBB"), so we
// map it to the ERP's code here before sending. Lists verified against the ERP's
// live payment_merchant / online_type (2026-11-03): co1 (HOUZS) and co2 (2990)
// differ — Public Bank is "Public" on co1 but "PBB" on co2, co2 only offers
// GHL/MBB/PBB/HLB, and co2 has no DuitNow/Voucher online type. Anything unmapped is
// sent AS-IS so the ERP safely queues it for a human rather than inventing a value.

/** A slip bank/host name → a canonical key (matched against brand AND host code). */
const BANK_CANON: [RegExp, string][] = [
  [/\b(maybank|mbb|malayan\s*banking)\b/i, "maybank"],
  [/\bcimb\b/i, "cimb"],
  [/\b(public\s*bank|public|pbb)\b/i, "public"],
  [/\b(hong\s*leong|hlbb?|hlb)\b/i, "hongleong"],
  [/\brhb\b/i, "rhb"],
  [/\balliance\b/i, "alliance"],
  [/\b(bank\s*islam|bimb)\b/i, "bankislam"],
  [/\b(bsn|bank\s*simpanan)\b/i, "bsn"],
  [/\b(pine\s*labs?|pinelabs)\b/i, "pinelabs"],
  [/\b(ambank|am\s*bank)\b/i, "ambank"],
  [/\baeon\b/i, "aeon"],
  [/\bhsbc\b/i, "hsbc"],
  [/\bghl\b/i, "ghl"],
];

/** canonical bank → the ERP payment_merchant code, per erp_company_id (1 / 2). */
const BANK_CODE: Record<string, Partial<Record<number, string>>> = {
  maybank: { 1: "MBB", 2: "MBB" },
  cimb: { 1: "CIMB" },
  public: { 1: "Public", 2: "PBB" },
  hongleong: { 1: "HLB", 2: "HLB" },
  rhb: { 1: "RHB" },
  alliance: { 1: "Alliance" },
  bankislam: { 1: "Bank Islam" },
  bsn: { 1: "BSN" },
  pinelabs: { 1: "Pinelabs" },
  ambank: { 1: "AmBank" },
  aeon: { 1: "AEON" },
  hsbc: { 1: "HSBC" },
  ghl: { 2: "GHL" },
};

/**
 * Map a card slip's bank/host to the ERP's payment_merchant code for this company.
 * Returns the code when known and offered by the company, else the original string
 * (so the ERP routes it to needs_manual rather than a wrong value). Never guesses.
 */
export function mapBankToErpCode(name: string | null | undefined, erpCompanyId: number): string | undefined {
  const raw = (name ?? "").trim();
  if (!raw) return undefined;
  for (const [re, canon] of BANK_CANON) {
    if (re.test(raw)) return BANK_CODE[canon]?.[erpCompanyId] ?? raw;
  }
  return raw;
}

/** The ERP's live online_type values, per erp_company_id. */
const ONLINE_TYPES_BY_CO: Record<number, string[]> = {
  1: ["Bank Transfer", "TNG", "Cheque", "DuitNow", "Voucher"],
  2: ["Bank Transfer", "TNG", "Cheque"],
};

/**
 * Map an Online payment's sub-type to the ERP's online_type for this company.
 * Connect's receipt reader already emits the same labels (DuitNow / Bank Transfer
 * / TNG / Cheque), so this is pass-through for co1; co2 has no DuitNow/Voucher, so
 * those are sent as-is and the ERP queues them for a human. Never guesses.
 */
export function mapOnlineType(type: string | null | undefined, erpCompanyId: number): string | undefined {
  const raw = (type ?? "").trim();
  if (!raw) return undefined;
  const hit = (ONLINE_TYPES_BY_CO[erpCompanyId] ?? []).find((v) => v.toLowerCase() === raw.toLowerCase());
  return hit ?? raw;
}

export interface BuildInput {
  paymentId: string;
  erpCompanyId: number | null;
  orderRef: string | null;
  amount: number | null;
  currency: string | null;
  storedMethod: string | null;
  reference: string | null;
  reading: ReceiptReading | null;
  slip: { base64: string; mime: string; bytes: number } | null;
  /** The slip's printed date, else a fallback (payment.createdAt as a KL date). */
  paidAtFallback: string;
  customerPhone?: string | null;
  customerName?: string | null;
}

export type BuildResult = { ok: true; body: ErpPaymentBody } | { ok: false; reason: string };

/**
 * PURE. Assemble and validate the ERP body from a payment, its slip and its
 * reading. A missing REQUIRED field returns a plain-reason failure the caller
 * records as BLOCKED (never a blind retry).
 */
export function buildPaymentBody(input: BuildInput): BuildResult {
  if (input.erpCompanyId == null) return { ok: false, reason: "This customer's company is not linked to the ERP yet." };
  const erpCompanyId = input.erpCompanyId;
  const orderRef = (input.orderRef ?? "").trim();
  if (!orderRef) return { ok: false, reason: "No ERP order number on this payment." };
  if (input.amount == null || !Number.isFinite(input.amount) || input.amount <= 0)
    return { ok: false, reason: "The amount is missing or not a positive number." };
  if (!input.slip) return { ok: false, reason: "No payment slip image to send." };
  const mime = input.slip.mime.split(";")[0].trim().toLowerCase();
  if (!(ALLOWED_SLIP_MIME as readonly string[]).includes(mime))
    return { ok: false, reason: `The slip is ${mime || "an unknown type"}, which the ERP cannot accept.` };
  if (input.slip.bytes > MAX_SLIP_BYTES) return { ok: false, reason: "The slip image is larger than 20 MB." };

  const resolved = resolveMethod(input.reading, input.storedMethod);
  if (!resolved) return { ok: false, reason: "Could not tell if this was paid by Card, Online or Cash — check the slip." };

  const paidAt = input.reading?.paidAt && DIGITS_DATE.test(input.reading.paidAt) ? input.reading.paidAt : input.paidAtFallback;
  if (!DIGITS_DATE.test(paidAt)) return { ok: false, reason: "No usable payment date." };

  const body: ErpPaymentBody = {
    connect_payment_id: input.paymentId,
    erp_company_id: erpCompanyId,
    order_ref: orderRef,
    amount: input.amount,
    method: resolved.method,
    paid_at: paidAt,
    slip_base64: input.slip.base64,
    slip_mime: mime as SlipMime,
  };

  const currency = normalizeCurrency(input.currency);
  if (currency) body.currency = currency;
  const phone = (input.customerPhone ?? "").trim();
  if (phone) body.customer_phone = phone;
  const name = (input.customerName ?? "").trim();
  if (name) body.customer_name = name;

  if (resolved.method === "Card") {
    // Map the slip's bank/host to the ERP's payment_merchant code for this company.
    const bank = mapBankToErpCode(resolved.bank, erpCompanyId);
    if (bank) body.bank = bank;
    // 0 = One Shot is meaningful and must be sent; only null/undefined is omitted.
    if (resolved.installmentMonths != null && resolved.installmentMonths >= 0 && resolved.installmentMonths <= 60)
      body.installment_months = resolved.installmentMonths;
  }
  if (resolved.method === "Online") {
    const onlineType = mapOnlineType(resolved.onlineType, erpCompanyId);
    if (onlineType) body.online_type = onlineType;
  }

  // approval_code: the reading's, else the stored reference for a card slip
  // (intake saves the approval code into reference_no for Card).
  const approval = resolved.approvalCode ?? (resolved.method === "Card" ? input.reference ?? undefined : undefined);
  if (approval && approval.trim()) body.approval_code = approval.trim();
  const reference = (input.reference ?? "").trim();
  if (reference) body.reference = reference;

  return { ok: true, body };
}

export type ErpOutcome =
  | { kind: "synced"; erpStatus: string | null; erpPaymentRef: string | null; soNo: string | null; idempotent: boolean }
  | { kind: "pending"; reason: string } // transient — retry with the same id
  | { kind: "blocked"; reason: string }; // payload / auth — surface, do not retry

export interface ErpResponseJson {
  ok?: boolean;
  status?: string;
  reason?: string;
  error?: string;
  idempotent?: boolean;
  erp_payment_ref?: string;
  so_no?: string;
}

/**
 * PURE. Decide the outcome from the HTTP status AND the body's `status` field,
 * per the contract. 200 recorded / 202 needs_manual / idempotent -> synced; 400
 * / 401 -> blocked; 409 processing / 5xx / 404 (endpoint not merged yet) /
 * anything unrecognised -> pending (retry with the same connect_payment_id).
 */
export function interpretErpResponse(httpStatus: number, json: ErpResponseJson | null): ErpOutcome {
  const j = json ?? {};
  const reason = j.reason || j.error || null;

  if ((httpStatus === 200 || httpStatus === 202) && j.ok !== false) {
    return {
      kind: "synced",
      erpStatus: j.status ?? (httpStatus === 202 ? "needs_manual" : "recorded"),
      erpPaymentRef: j.erp_payment_ref ?? null,
      soNo: j.so_no ?? null,
      idempotent: j.idempotent === true,
    };
  }
  if (httpStatus === 401) return { kind: "blocked", reason: "The ERP rejected the service token (401)." };
  if (httpStatus === 409) return { kind: "pending", reason: "The ERP is still processing this payment (409)." };
  // An explicit ok:false (incl. the 400 payload-problem case) is a rejection to
  // surface, never a blind retry — even if it somehow arrived with a 200.
  if (j.ok === false || httpStatus === 400) return { kind: "blocked", reason: reason || "The ERP rejected the payment details." };
  return { kind: "pending", reason: reason ? `ERP ${httpStatus}: ${reason}` : `ERP answered ${httpStatus}.` };
}

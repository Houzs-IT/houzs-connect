import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

/*
  Reading a payment slip off an image.

  Customers send all kinds of pictures — posters, product photos, screenshots
  of chats. Only a picture that shows money changing hands should become a
  payment to check, so Claude looks at it, says whether it is a receipt, and
  reads it.

  The reading rules are the Houzs ERP's (backend/src/scm/routes/scan-payment.ts,
  the Payments panel's receipt OCR), so Connect records a payment the way the
  ERP does: three methods (Card / Online / Cash); a card-terminal slip — EPP
  included — is Card with the HOST bank and the tenure ("One Shot" when none is
  printed); DuitNow / transfer / Touch 'n Go / cheque is Online with its type;
  the date is the one printed on the slip, never today. Connect is not
  connected to the ERP, so the values are fixed lists here rather than the
  ERP's live dropdowns.

  Needs ANTHROPIC_API_KEY as a Worker secret. Without it (or when the call
  fails) the answer is "unavailable" and the caller keeps the old behaviour —
  every image becomes a payment to check — so a real slip is never lost to an
  outage.
*/

const MODEL = "claude-sonnet-5-5";

const METHODS = ["Card", "Online", "Cash", "None"] as const;
const ONLINE_TYPES = ["DuitNow", "Bank Transfer", "TNG", "Cheque", "None"] as const;

const SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean", description: "True only for proof that money was paid." },
    method: { type: "string", enum: [...METHODS], description: "Card, Online or Cash; None when not a receipt." },
    online_type: { type: "string", enum: [...ONLINE_TYPES], description: "For Online only; None otherwise." },
    bank: {
      type: ["string", "null"],
      description:
        "Card: the HOST / acquirer bank as printed (Maybank, CIMB, Public Bank, Hong Leong, RHB, AEON…). Online: the paying bank if printed. Null otherwise.",
    },
    installment_months: {
      type: ["integer", "null"],
      description: "Card only: the printed tenure in months; 0 = One Shot (no tenure printed). Null for Online / Cash.",
    },
    approval_code: { type: ["string", "null"], description: "Card approval / auth code, bare digits/letters." },
    reference: { type: ["string", "null"], description: "Transfer / DuitNow reference or transaction id as printed." },
    amount: { type: ["number", "null"], description: "The printed TOTAL charged, as a number in RM. Never a monthly repayment." },
    paid_at: { type: ["string", "null"], description: "The printed transaction date as YYYY-MM-DD (two-digit years are 20YY)." },
    recipient: { type: ["string", "null"], description: "Who received the money, as printed." },
    uncertain: { type: ["string", "null"], description: "Anything smudged or ambiguous the person checking should look at." },
  },
  required: [
    "is_receipt",
    "method",
    "online_type",
    "bank",
    "installment_months",
    "approval_code",
    "reference",
    "amount",
    "paid_at",
    "recipient",
    "uncertain",
  ],
  additionalProperties: false,
} as const;

const PROMPT = `A customer of Houzs Century, a Malaysian furniture retailer, sent this picture in WhatsApp.

FIRST decide whether it is proof that the customer PAID money: a bank card-terminal slip (Maybank / CIMB / Public Bank / Hong Leong / RHB / AEON terminal), an EPP / instalment approval slip, a DuitNow / bank-transfer / Touch 'n Go confirmation, a cheque, or a cash receipt. Posters, product or room photos, chat screenshots, quotations and invoices that only show an amount OWED are NOT receipts: is_receipt = false, method = "None", everything else null / "None".

For a receipt, read EXACTLY what is printed. Do not correct, reconcile or recompute any figure, and never derive a total the receipt does not print (not from a monthly repayment × tenure, not from line items). A field that is not printed is null — never guess.

METHOD — exactly three:
1. Any CARD-TERMINAL receipt — a normal swipe ("SALE" / "APPROVED") or an EPP / instalment approval (a "TENURE", "06 MONTHS", "6 MTHS", "MONTHLY REPAYMENT" line, the words EPP / EASY PAYMENT PLAN / INSTALMENT / ANSURAN / IPP) → method "Card".
   • bank = the HOST / acquirer / terminal bank ("Host: MBB" → Maybank; Public Bank; CIMB; Hong Leong for HLB; RHB; an AEON terminal → AEON).
   • installment_months = the printed tenure ("TENURE 06 MONTHS" → 6, "IPP 12" → 12). No month count printed → 0 (One Shot) — even when it says EPP / INSTALMENT with no number. Never default to 12.
   • approval_code = the APPROVAL CODE / APPR / AUTH CODE / KOD KELULUSAN, bare ("APPROVAL CODE 073496" → "073496").
2. DUITNOW / BANK TRANSFER (IBG, instant transfer) / TOUCH 'N GO / E-WALLET / CHEQUE → method "Online", online_type DuitNow / Bank Transfer / TNG / Cheque. installment_months = null. reference = the transfer reference or transaction id.
3. CASH receipt → method "Cash".

amount = the charged TOTAL / CARD TOTAL / AMOUNT / JUMLAH / SALE AMOUNT ("RM 4,600.00" → 4600). For EPP it is the full financed total, NOT the monthly repayment.
paid_at = the receipt's own printed date ("DATE 22/06/26 14:03" → "2026-06-22"). It is often days in the past; never use today's date.
When something is smudged or two readings are equally plausible, give your best reading and say what is unsure in "uncertain".`;

export type ReceiptReading = {
  isReceipt: boolean;
  method: "Card" | "Online" | "Cash" | null;
  onlineType: "DuitNow" | "Bank Transfer" | "TNG" | "Cheque" | null;
  bank: string | null;
  /** 0 = One Shot. */
  installmentMonths: number | null;
  approvalCode: string | null;
  reference: string | null;
  amount: number | null;
  paidAt: string | null;
  recipient: string | null;
  uncertain: string | null;
};

export type ReceiptResult = { status: "read"; reading: ReceiptReading } | { status: "unavailable"; error: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * fetch, plus a log line when the API answers with an error. The SDK reports a
 * 400 with an empty body as just "400 status code (no body)", which says
 * nothing about whether the answer came from Claude's API or from something in
 * between; the headers (request-id is Anthropic's, cf-ray / server Cloudflare's)
 * and the raw body do. Never logs the request headers (they carry the key).
 */
/**
 * The runtime's own fetch, not Next.js's patched one. Inside the Connect Worker
 * every call through Next's fetch wrapper (which rebuilds the request for its
 * data cache) came back as a bare 400 — no body, no headers, so it never
 * reached api.anthropic.com — while the same SDK call on the plain Workers
 * runtime got a real answer. Next keeps the unpatched fetch on
 * `_nextOriginalFetch`; fall back to the global one if it ever goes away.
 */
const rawFetch = (): typeof fetch =>
  (globalThis.fetch as typeof fetch & { _nextOriginalFetch?: typeof fetch })._nextOriginalFetch ?? globalThis.fetch;

const loggedFetch: typeof fetch = async (input, init) => {
  const res = await rawFetch()(input, init);
  if (!res.ok) {
    const body = await res
      .clone()
      .text()
      .catch((e) => `<unreadable: ${(e as Error)?.message}>`);
    const h = (k: string) => res.headers.get(k) ?? "-";
    const sent = typeof init?.body === "string" ? `${init.body.length}b string` : init?.body ? (init.body as object).constructor?.name ?? typeof init.body : "none";
    console.warn(
      "RECEIPT_API_ERROR",
      JSON.stringify({
        status: res.status,
        url: typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url,
        requestId: h("request-id"),
        cfRay: h("cf-ray"),
        server: h("server"),
        contentType: h("content-type"),
        sent,
        key: keyShape(),
        body: body.slice(0, 600),
      })
    );
  }
  return res;
};

/** Switched off until RECEIPT_AI=on (paused 2026-10-04: live calls failed). */
export function receiptVisionConfigured(): boolean {
  return process.env.RECEIPT_AI === "on" && !!process.env.ANTHROPIC_API_KEY?.trim();
}

/** What the key looks like, never the key: catches a pasted space or line break. */
function keyShape(): string {
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  const trimmed = raw.trim();
  return `len=${raw.length} trimmedLen=${trimmed.length} sk-ant=${trimmed.startsWith("sk-ant-")} innerWhitespace=${/\s/.test(trimmed)}`;
}

export async function readReceipt(bytes: ArrayBuffer, mimeType: string): Promise<ReceiptResult> {
  if (!receiptVisionConfigured()) return { status: "unavailable", error: "receipt reading is off (RECEIPT_AI) or ANTHROPIC_API_KEY is not set" };
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const data = toBase64(bytes);
  const file =
    mime === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : IMAGE_TYPES.has(mime)
        ? ({ type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data } } as const)
        : null;
  // Not something Claude can look at (e.g. a Word file): let a person decide.
  if (!file) return { status: "unavailable", error: `cannot read ${mime}` };

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
      timeout: 60_000,
      maxRetries: 1,
      fetch: loggedFetch,
    });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(SCHEMA) },
      messages: [{ role: "user", content: [file, { type: "text", text: PROMPT }] }],
    });
    if (response.stop_reason === "refusal") return { status: "unavailable", error: "declined" };
    const out = response.parsed_output;
    if (!out) return { status: "unavailable", error: "no structured answer" };
    const method = out.method === "None" ? null : out.method;
    return {
      status: "read",
      reading: {
        isReceipt: out.is_receipt && method != null,
        method,
        onlineType: method === "Online" && out.online_type !== "None" ? out.online_type : null,
        bank: out.bank,
        installmentMonths:
          method === "Card" && typeof out.installment_months === "number" && out.installment_months >= 0 ? out.installment_months : null,
        approvalCode: out.approval_code,
        reference: out.reference,
        amount: typeof out.amount === "number" && Number.isFinite(out.amount) && out.amount > 0 ? out.amount : null,
        paidAt: out.paid_at && /^\d{4}-\d{2}-\d{2}$/.test(out.paid_at) ? out.paid_at : null,
        recipient: out.recipient,
        uncertain: out.uncertain,
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.APIError) return { status: "unavailable", error: `Claude API ${e.status ?? ""} ${e.message}` };
    return { status: "unavailable", error: (e as Error)?.message ?? String(e) };
  }
}

/**
 * "Paid by" as the Payments page shows it: the bank for a card slip, the
 * transfer type for Online (DuitNow, TNG …), "Cash".
 */
export function paidBy(r: ReceiptReading): string | null {
  if (r.method === "Card") return r.bank;
  if (r.method === "Online") return r.onlineType ?? r.bank;
  if (r.method === "Cash") return "Cash";
  return null;
}

/** One line for the person checking: what was read beyond amount / reference. */
export function readingNote(r: ReceiptReading): string | null {
  const parts = [
    r.method === "Card" && "Card",
    r.method === "Card" && r.bank && `host ${r.bank}`,
    r.method === "Card" && r.installmentMonths != null && (r.installmentMonths === 0 ? "One Shot" : `${r.installmentMonths} months`),
    r.method === "Card" && r.approvalCode && `approval ${r.approvalCode}`,
    r.method === "Online" && r.bank && `from ${r.bank}`,
    r.paidAt && `paid ${r.paidAt}`,
    r.recipient && `to ${r.recipient}`,
    r.uncertain && `check: ${r.uncertain}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

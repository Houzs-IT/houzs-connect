// Receipt OCR. In DEMO the "receipt" is the text the customer sends (or a caption);
// in LIVE this is where a vision/OCR provider (Google Vision, Textract, or an LLM with
// image input) would read the uploaded slip. The parser below extracts the fields we
// auto-record: amount, reference/transaction id, and the bank/method.

export interface OcrResult {
  amount: number | null;
  currency: string;
  reference: string | null;
  method: string | null;
  raw: string;
}

/** Parse a Malaysian bank-transfer slip's text into structured payment fields. */
export function runOcr(text: string): OcrResult {
  const raw = (text ?? "").trim();

  // Amount: "RM 1,200.00", "MYR1200", "amount: 850", "1,850.00"
  let amount: number | null = null;
  const amtMatch =
    raw.match(/(?:rm|myr)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    raw.match(/amount[^0-9]*([\d,]+(?:\.\d{1,2})?)/i) ||
    raw.match(/\b([\d,]{2,}(?:\.\d{2}))\b/);
  if (amtMatch) {
    const n = Number(amtMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n)) amount = n;
  }

  // Reference / transaction id.
  const refMatch =
    raw.match(/(?:ref(?:erence)?|txn|transaction|receipt)\s*(?:no\.?|id|#|:)?\s*([a-z0-9\-]{4,})/i);
  const reference = refMatch ? refMatch[1].toUpperCase() : null;

  // Method / bank.
  const bank = raw.match(/\b(maybank|cimb|public bank|rhb|hong leong|ambank|bank islam|touch\s?'?n\s?go|tng|duitnow|fpx|grabpay)\b/i);
  const method = bank ? bank[1] : /transfer|slip|payment/i.test(raw) ? "bank transfer" : null;

  return { amount, currency: "MYR", reference, method, raw };
}

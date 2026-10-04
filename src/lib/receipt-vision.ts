import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

/*
  Reading a payment slip off an image.

  Customers send all kinds of pictures — posters, product photos, screenshots
  of chats. Only a picture that shows money changing hands should become a
  payment to check, so Claude looks at it and says whether it is a receipt and
  what it reads: amount, bank / wallet, reference, date.

  Needs ANTHROPIC_API_KEY as a Worker secret. Without it (or when the call
  fails) the answer is "unavailable" and the caller keeps the old behaviour —
  every image becomes a payment to check — so a real slip is never lost to an
  outage.
*/

const SCHEMA = {
  type: "object",
  properties: {
    is_receipt: {
      type: "boolean",
      description: "True only for proof of a payment: bank transfer slip, DuitNow/e-wallet receipt, deposit slip, card receipt.",
    },
    amount: {
      type: ["number", "null"],
      description: "The amount paid, as a number without currency or thousands separators. Null when no paid amount is visible.",
    },
    currency: { type: ["string", "null"], description: "ISO code, e.g. MYR." },
    bank: { type: ["string", "null"], description: "Bank or wallet, e.g. Maybank, CIMB, Touch 'n Go, DuitNow." },
    reference: { type: ["string", "null"], description: "Transaction / reference number as printed." },
    paid_at: { type: ["string", "null"], description: "Date and time as printed on the slip." },
    recipient: { type: ["string", "null"], description: "Who received the money, as printed." },
  },
  required: ["is_receipt", "amount", "currency", "bank", "reference", "paid_at", "recipient"],
  additionalProperties: false,
} as const;

export type ReceiptReading = {
  isReceipt: boolean;
  amount: number | null;
  currency: string | null;
  bank: string | null;
  reference: string | null;
  paidAt: string | null;
  recipient: string | null;
};

export type ReceiptResult = { status: "read"; reading: ReceiptReading } | { status: "unavailable"; error: string };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function receiptVisionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function readReceipt(bytes: ArrayBuffer, mimeType: string): Promise<ReceiptResult> {
  if (!receiptVisionConfigured()) return { status: "unavailable", error: "ANTHROPIC_API_KEY is not set" };
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
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2048,
      output_config: { effort: "low", format: jsonSchemaOutputFormat(SCHEMA) },
      messages: [
        {
          role: "user",
          content: [
            file,
            {
              type: "text",
              text:
                "A customer of a Malaysian furniture company sent this in WhatsApp. Is it proof that they paid money " +
                "(bank transfer slip, DuitNow / e-wallet receipt, deposit slip, card receipt)? If yes, read the amount " +
                "paid and the other details exactly as printed. Posters, product photos, chat screenshots and invoices " +
                "that only show an amount owed are not receipts.",
            },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { status: "unavailable", error: "declined" };
    const out = response.parsed_output;
    if (!out) return { status: "unavailable", error: "no structured answer" };
    return {
      status: "read",
      reading: {
        isReceipt: out.is_receipt,
        amount: typeof out.amount === "number" && Number.isFinite(out.amount) && out.amount > 0 ? out.amount : null,
        currency: out.currency,
        bank: out.bank,
        reference: out.reference,
        paidAt: out.paid_at,
        recipient: out.recipient,
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.APIError) return { status: "unavailable", error: `Claude API ${e.status ?? ""} ${e.message}` };
    return { status: "unavailable", error: (e as Error)?.message ?? String(e) };
  }
}

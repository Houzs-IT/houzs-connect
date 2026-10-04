import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { payment as paymentTable } from "@/db/schema";
import { downloadMedia } from "@/lib/whatsapp/download";
import { paidBy, readingNote, readReceipt } from "@/lib/receipt-vision";

/*
  An image or document a customer sent: does it become a payment to check?

  - Claude reads it and finds a paid amount  -> a payment, pre-filled.
  - Claude reads it and finds no paid amount -> nothing; it stays a chat
    message (posters, product photos, screenshots).
  - Claude cannot be asked (no key, Meta or API down) -> a blank payment, as
    before, so a real slip is never dropped.
*/

type Intake = {
  contactId: string;
  conversationId: string;
  orderRef: string | null;
  mediaId: string | null;
  caption: string | null;
};

async function intake(p: Intake): Promise<void> {
  const db = getDb();
  const blank = () =>
    db.insert(paymentTable).values({
      contactId: p.contactId,
      conversationId: p.conversationId,
      amount: null,
      method: null,
      referenceNo: null,
      orderRef: p.orderRef,
      receiptMediaUrl: p.mediaId ? `whatsapp-media:${p.mediaId}` : null,
      ocrRawText: p.caption,
      status: "PENDING",
    });

  if (!p.mediaId) {
    await blank();
    return;
  }
  const file = await downloadMedia(p.mediaId);
  if (!file.ok) {
    await blank();
    return;
  }
  const res = await readReceipt(file.bytes, file.mimeType);
  if (res.status === "unavailable") {
    console.warn("RECEIPT_READ_UNAVAILABLE", res.error);
    await blank();
    return;
  }
  const r = res.reading;
  if (!r.isReceipt || r.amount == null) return;

  await db.insert(paymentTable).values({
    contactId: p.contactId,
    conversationId: p.conversationId,
    amount: r.amount,
    currency: "MYR",
    method: paidBy(r),
    // A card slip's approval code is its reference; a transfer has its own.
    referenceNo: r.method === "Card" ? (r.approvalCode ?? r.reference) : (r.reference ?? r.approvalCode),
    orderRef: p.orderRef,
    receiptMediaUrl: `whatsapp-media:${p.mediaId}`,
    ocrRawText: [p.caption, readingNote(r)].filter(Boolean).join(" · ") || null,
    status: "PENDING",
  });
}

/**
 * Run the intake after the webhook has answered (reading an image takes a few
 * seconds and Meta wants its 200 quickly). Outside the Worker runtime it just
 * runs inline.
 */
export async function intakeReceipt(p: Intake): Promise<void> {
  const job = intake(p).catch((e) => console.error("RECEIPT_INTAKE_FAIL", e));
  try {
    getCloudflareContext().ctx.waitUntil(job);
  } catch {
    await job;
  }
}

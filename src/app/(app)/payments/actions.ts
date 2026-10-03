"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { payment } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

/** The member, and the payment must belong to a contact in their company. */
async function authorize(paymentId: string) {
  if (!paymentId) return null;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const row = await db.query.payment.findFirst({ where: eq(payment.id, paymentId), with: { contact: true } });
  if (!row || row.contact.companyId !== me.companyId) return null;
  return { db, row };
}

/**
 * Correct what OCR read off a receipt — amount, reference, bank, order. Only
 * while the receipt is still To check: a confirmed or rejected one is a record.
 */
export async function updatePaymentFields(
  paymentId: string,
  fields: { amount: string; referenceNo: string; method: string; orderRef: string }
): Promise<{ ok: boolean; error?: string }> {
  const auth = await authorize(paymentId);
  if (!auth) return { ok: false, error: "Not found." };
  if (auth.row.status !== "PENDING") return { ok: false, error: "Only a receipt that is still to check can be changed." };
  const raw = fields.amount.replace(/[^\d.]/g, "");
  const amount = raw ? Number(raw) : null;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, error: "That amount is not a number." };
  await auth.db
    .update(payment)
    .set({
      amount,
      referenceNo: fields.referenceNo.trim() || null,
      method: fields.method.trim() || null,
      orderRef: fields.orderRef.trim() || null,
    })
    .where(eq(payment.id, paymentId));
  revalidatePath("/payments");
  return { ok: true };
}

/** Confirm, reject, or move back to To check. */
export async function reviewPayment(
  paymentId: string,
  status: "VERIFIED" | "REJECTED" | "PENDING"
): Promise<{ ok: boolean }> {
  const auth = await authorize(paymentId);
  if (!auth) return { ok: false };
  await auth.db.update(payment).set({ status }).where(eq(payment.id, paymentId));
  revalidatePath("/payments");
  return { ok: true };
}

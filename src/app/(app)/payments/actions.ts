"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, conversation, payment } from "@/db/schema";
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

/** Contacts for the Record payment picker: by name or phone digits, this company only. */
export async function findPaymentContacts(q: string): Promise<{ id: string; name: string | null; phone: string }[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const text = q.trim();
  if (text.length < 2) return [];
  const digits = text.replace(/\D/g, "");
  return getDb()
    .select({ id: contact.id, name: contact.name, phone: contact.phone })
    .from(contact)
    .where(
      and(
        eq(contact.companyId, me.companyId),
        or(ilike(contact.name, `%${text}%`), ...(digits.length >= 3 ? [ilike(contact.phone, `%${digits}%`)] : []))
      )
    )
    .limit(8);
}

/**
 * Record a payment by hand — a bank transfer seen in the statement, cash at the
 * showroom. Saved in Connect only; nothing is written to the ERP.
 */
export async function recordPayment(input: {
  contactId: string;
  amount: string;
  method: string;
  referenceNo: string;
  orderRef: string;
  confirmed: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const db = getDb();
  const who = await db.query.contact.findFirst({
    where: and(eq(contact.id, input.contactId), eq(contact.companyId, me.companyId)),
  });
  if (!who) return { ok: false, error: "Choose the customer first." };
  const amount = Number(input.amount.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter the amount." };
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.contactId, who.id),
    orderBy: desc(conversation.lastMessageAt),
  });
  const [row] = await db
    .insert(payment)
    .values({
      contactId: who.id,
      conversationId: convo?.id ?? null,
      amount,
      method: input.method.trim() || null,
      referenceNo: input.referenceNo.trim() || null,
      orderRef: input.orderRef.trim() || null,
      status: input.confirmed ? "VERIFIED" : "PENDING",
    })
    .returning({ id: payment.id });
  revalidatePath("/payments");
  return { ok: true, id: row.id };
}

import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, payment } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

/** Payments → Export: every receipt of the member's company as CSV. */
export async function GET() {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const rows = await getDb()
    .select({
      createdAt: payment.createdAt,
      name: contact.name,
      phone: contact.phone,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      referenceNo: payment.referenceNo,
      orderRef: payment.orderRef,
      status: payment.status,
    })
    .from(payment)
    .innerJoin(contact, eq(contact.id, payment.contactId))
    .where(eq(contact.companyId, me.companyId))
    .orderBy(desc(payment.createdAt));

  const cell = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const line = (...v: unknown[]) => v.map(cell).join(",");
  const lines = [
    line("Received (UTC)", "Customer", "Phone", "Amount", "Currency", "Paid by", "Reference", "Order", "Status"),
    ...rows.map((r) =>
      line(r.createdAt.toISOString(), r.name, r.phone, r.amount, r.currency, r.method, r.referenceNo, r.orderRef, r.status)
    ),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="connect-payments.csv"',
    },
  });
}

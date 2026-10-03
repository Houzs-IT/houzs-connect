import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, payment } from "@/db/schema";
import { authenticate, unauthorized } from "@/lib/api-keys";

const STATUSES = new Set(["PENDING", "VERIFIED", "REJECTED"]);

/** GET /api/v1/payments?status=&limit= — receipts of this key's company, newest first. */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "").toUpperCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const rows = await getDb()
    .select({
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      referenceNo: payment.referenceNo,
      orderRef: payment.orderRef,
      status: payment.status,
      createdAt: payment.createdAt,
      contactName: contact.name,
      phone: contact.phone,
    })
    .from(payment)
    .innerJoin(contact, eq(contact.id, payment.contactId))
    .where(
      and(
        eq(contact.companyId, auth.companyId),
        STATUSES.has(status) ? eq(payment.status, status as "PENDING" | "VERIFIED" | "REJECTED") : undefined
      )
    )
    .orderBy(desc(payment.createdAt))
    .limit(limit);
  return Response.json({ data: rows });
}

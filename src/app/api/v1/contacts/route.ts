import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact } from "@/db/schema";
import { attrs } from "@/lib/format";
import { authenticate, unauthorized } from "@/lib/api-keys";

/**
 * GET /api/v1/contacts?q=&limit= — this key's company's contacts, newest
 * first. `q` matches name or phone digits. At most 200 per call.
 */
export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const digits = q.replace(/\D/g, "");
  const rows = await getDb()
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.companyId, auth.companyId),
        q ? or(ilike(contact.name, `%${q}%`), ...(digits.length >= 3 ? [ilike(contact.phone, `%${digits}%`)] : [])) : undefined
      )
    )
    .orderBy(desc(contact.updatedAt))
    .limit(limit);
  return Response.json({
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      blocked: c.blocked,
      marketingOptIn: c.marketingOptIn,
      attributes: attrs(c.attributes),
      updatedAt: c.updatedAt,
    })),
  });
}

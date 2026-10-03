"use server";

import { createId } from "@paralleldrive/cuid2";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";
import { homeCompanyId } from "@/lib/access-requests";

/**
 * "Request access" from the sign-in page. Public — no session — so it only
 * ever writes a pending request, and it is rate-limited: five per address per
 * hour, and one open request per email.
 */
export async function submitAccessRequest(input: {
  name: string;
  email: string;
  phone: string;
  department: string;
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  const department = input.department.trim().slice(0, 80);
  if (!name || !department) return { ok: false, error: "name" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email" };

  const db = getDb();
  await ensureAccessTables(db);
  const companyId = await homeCompanyId();
  if (!companyId) return { ok: false, error: "closed" };

  const h = await headers();
  const ip = (h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || null;
  if (ip) {
    const recent = (await db.execute(sql`
      select count(*)::int as n from connect.access_request
      where requester_ip = ${ip} and created_at > now() - interval '1 hour'
    `)) as unknown as { n: number }[];
    if ((recent[0]?.n ?? 0) >= 5) return { ok: false, error: "rate" };
  }
  const open = (await db.execute(sql`
    select id from connect.access_request
    where email = ${email} and status in ('pending_manager', 'pending_final') limit 1
  `)) as unknown as { id: string }[];
  // Already waiting: say so as a success — a second copy would only be noise.
  if (open[0]) return { ok: true };

  await db.execute(sql`
    insert into connect.access_request (id, company_id, name, email, phone, department, note, requester_ip)
    values (${createId()}, ${companyId}, ${name}, ${email}, ${input.phone.trim().slice(0, 40) || null},
      ${department}, ${input.note.trim().slice(0, 500) || null}, ${ip})
  `);
  return { ok: true };
}

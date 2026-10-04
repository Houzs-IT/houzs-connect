import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";

/*
  Access requests from the sign-in page. Two steps: a department manager
  vouches for the person (pending_manager → pending_final), then a Super Admin
  picks the role and companies (→ approved), and that creates the member rows.
  Either step can reject. Stored in connect.access_request (migration 0013).
*/

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  note: string | null;
  status: "pending_manager" | "pending_final" | "approved" | "rejected";
  managerName: string | null;
  createdAt: Date;
};

/** Requests land in the home company — the first one, the same one sign-in uses. */
export async function homeCompanyId(): Promise<string | null> {
  const r = (await getDb().execute(sql`
    select id from connect.company order by created_at asc limit 1
  `)) as unknown as { id: string }[];
  return r[0]?.id ?? null;
}

export async function openRequests(companyId: string): Promise<AccessRequest[]> {
  const db = getDb();
  await ensureAccessTables(db);
  const rows = (await db.execute(sql`
    select r.id, r.name, r.email, r.phone, r.department, r.note, r.status, r.created_at, m.name as manager_name
    from connect.access_request r
    left join connect.member m on m.id = r.manager_member_id
    where r.company_id = ${companyId} and r.status in ('pending_manager', 'pending_final')
    order by r.created_at asc
  `)) as unknown as {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    department: string | null;
    note: string | null;
    status: AccessRequest["status"];
    created_at: string | Date;
    manager_name: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    department: r.department,
    note: r.note,
    status: r.status,
    managerName: r.manager_name,
    createdAt: new Date(r.created_at),
  }));
}

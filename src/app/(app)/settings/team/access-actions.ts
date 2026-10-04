"use server";

import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";
import { getCurrentMember } from "@/lib/current-member";
import { can } from "@/lib/permissions";

const GRANTABLE = new Set(["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"]);

async function load(id: string) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  await ensureAccessTables(db);
  const r = (await db.execute(sql`
    select id, name, email, status from connect.access_request where id = ${id} and company_id = ${me.companyId}
  `)) as unknown as { id: string; name: string; email: string; status: string }[];
  return r[0] ? { me, db, req: r[0] } : null;
}

/** Step 1: a department manager vouches for the person. */
export async function approveAsManager(id: string): Promise<{ ok: boolean; error?: string }> {
  const x = await load(id);
  if (!x) return { ok: false, error: "Not found." };
  if (!(await can(x.me, "approveDept"))) return { ok: false, error: "Only a department manager can do this step." };
  if (x.req.status !== "pending_manager") return { ok: false, error: "This request has moved on already." };
  await x.db.execute(sql`
    update connect.access_request
    set status = 'pending_final', manager_member_id = ${x.me.id}, manager_decided_at = now()
    where id = ${id} and status = 'pending_manager'
  `);
  revalidatePath("/settings/team");
  return { ok: true };
}

/**
 * Step 2: a Super Admin sets the role and the companies, which creates (or
 * reactivates) one member row per company. Signing in still needs a Houzs ERP
 * account with the same email — Connect checks the ERP password.
 */
export async function approveFinal(id: string, role: string, companyIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const x = await load(id);
  if (!x) return { ok: false, error: "Not found." };
  if (!(await can(x.me, "approveFinal"))) return { ok: false, error: "Only a Super Admin can give final approval." };
  if (x.req.status !== "pending_final" && x.req.status !== "pending_manager") return { ok: false, error: "This request is closed." };
  if (!GRANTABLE.has(role)) return { ok: false, error: "Choose a role." };
  const companies = (await x.db.execute(sql`
    select id from connect.company where active = true
  `)) as unknown as { id: string }[];
  const valid = new Set(companies.map((c) => c.id));
  const chosen = [...new Set(companyIds)].filter((c) => valid.has(c));
  if (!chosen.length) return { ok: false, error: "Choose at least one company." };

  for (const companyId of chosen) {
    await x.db.execute(sql`
      insert into connect.member (id, company_id, name, email, role, active)
      values (${createId()}, ${companyId}, ${x.req.name}, ${x.req.email}, ${role}::"connect"."Role", true)
      on conflict (company_id, email) do update set role = excluded.role, active = true
    `);
  }
  await x.db.execute(sql`
    update connect.access_request
    set status = 'approved', final_member_id = ${x.me.id}, final_decided_at = now(),
      granted_role = ${role}, granted_company_ids = ${JSON.stringify(chosen)}::jsonb,
      manager_member_id = coalesce(manager_member_id, ${x.me.id}), manager_decided_at = coalesce(manager_decided_at, now())
    where id = ${id}
  `);
  revalidatePath("/settings/team");
  return { ok: true };
}

export async function rejectRequest(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const x = await load(id);
  if (!x) return { ok: false, error: "Not found." };
  const step = x.req.status === "pending_manager" ? "approveDept" : "approveFinal";
  if (!(await can(x.me, step))) return { ok: false, error: "You cannot decide this step." };
  await x.db.execute(sql`
    update connect.access_request
    set status = 'rejected', reject_reason = ${reason.trim().slice(0, 300) || null},
      final_member_id = ${x.me.id}, final_decided_at = now()
    where id = ${id} and status in ('pending_manager', 'pending_final')
  `);
  revalidatePath("/settings/team");
  return { ok: true };
}

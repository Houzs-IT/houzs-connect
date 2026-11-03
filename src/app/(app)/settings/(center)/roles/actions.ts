"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";
import { getCurrentMember } from "@/lib/current-member";
import { CAPABILITIES, MATRIX_ROLES, can } from "@/lib/permissions";

/** Turn one cell of this company's matrix on or off. Super Admins only. */
export async function setPermission(role: string, capability: string, allowed: boolean): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "manageSys"))) return { ok: false, error: "Only a Super Admin can change roles." };
  if (role === "SUPER_ADMIN") return { ok: false, error: "SUPER ADMIN always has every permission." };
  if (!(MATRIX_ROLES as readonly string[]).includes(role) || !(CAPABILITIES as readonly string[]).includes(capability)) {
    return { ok: false, error: "Unknown role or permission." };
  }
  const db = getDb();
  await ensureAccessTables(db);
  await db.execute(sql`
    insert into connect.role_permission (company_id, role, capability, allowed, updated_by_member_id, updated_at)
    values (${me.companyId}, ${role}, ${capability}, ${allowed}, ${me.id}, now())
    on conflict (company_id, role, capability) do update
      set allowed = excluded.allowed, updated_by_member_id = excluded.updated_by_member_id, updated_at = now()
  `);
  revalidatePath("/settings/roles");
  return { ok: true };
}

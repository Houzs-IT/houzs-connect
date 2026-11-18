"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { ensureAutoAssignTable } from "@/db/ensure-auto-assign";
import { autoAssign } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Turn the session company's auto-assignment on or off, and optionally scope it
 * to one department (null = all departments). Owner/admin only.
 */
export async function saveAutoAssign(enabled: boolean, departmentId: string | null): Promise<SaveResult> {
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) {
    return { ok: false, error: "Only an owner or admin can change auto-assignment." };
  }
  const db = getDb();
  await ensureAutoAssignTable(db);
  const values = {
    companyId: me.companyId,
    enabled,
    departmentId: departmentId || null,
    updatedAt: new Date(),
    updatedBy: me.email,
  };
  await db
    .insert(autoAssign)
    .values(values)
    .onConflictDoUpdate({ target: autoAssign.companyId, set: values });
  revalidatePath("/settings/auto-assign");
  return { ok: true };
}

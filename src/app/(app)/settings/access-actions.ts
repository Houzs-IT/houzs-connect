"use server";

// Manage who can work in THIS company, on top of what the ERP granted.
//
// The ERP org sync is the base: it creates a member row per ERP company grant
// (src/lib/sync/erp-org.ts). But a Connect-only company the ERP does not know
// about — Hookka is the first — gets no members from it, and there is no way for
// the ERP to grant access to a company it has never heard of. These actions fill
// that gap: an owner/admin grants a person an active member row here by email.
//
// The grant is MANUAL: erp_user_id stays null. That matters because the org
// sync's soft-deactivate only ever touches rows that HAVE an erp_user_id (see
// planOrgSync's final loop) — so a manual grant is never swept away on the next
// login. For the same reason, only manual rows are editable/removable here: an
// ERP-synced member's role is the ERP's to decide and would be overwritten on
// their next sign-in anyway.

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

/** Roles an admin may hand out here. OWNER is deliberately not grantable. */
const GRANTABLE = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;
type Grantable = (typeof GRANTABLE)[number];

function cleanRole(v: string): Grantable {
  return (GRANTABLE as readonly string[]).includes(v) ? (v as Grantable) : "AGENT";
}

/** The caller, only when they may manage access (owner or admin of the company). */
async function manager() {
  const me = await getCurrentMember();
  if (!me || (me.role !== "OWNER" && me.role !== "ADMIN")) return null;
  return me;
}

export async function grantAccess(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = cleanRole(String(formData.get("role") ?? "AGENT"));
  // The email is the identity the login upsert and company switcher both key on,
  // so it must be the person's real Houzs ERP login email or they still cannot
  // reach this company.
  if (!email || !email.includes("@")) return;

  const db = getDb();
  await db
    .insert(member)
    .values({ companyId: me.companyId, email, name: name || email, role })
    .onConflictDoUpdate({
      target: [member.companyId, member.email],
      // Re-granting reactivates and sets the chosen role; a name is only
      // overwritten when one was actually typed.
      set: { active: true, role, ...(name ? { name } : {}) },
    });

  revalidatePath("/settings");
  revalidatePath("/inbox");
}

export async function setMemberRole(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const role = cleanRole(String(formData.get("role") ?? "AGENT"));
  if (!id) return;

  const db = getDb();
  await db
    .update(member)
    .set({ role })
    .where(
      and(eq(member.id, id), eq(member.companyId, me.companyId), isNull(member.erpUserId))
    );
  revalidatePath("/settings");
  revalidatePath("/inbox");
}

export async function revokeAccess(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  // Never let an admin lock themselves out of the company they are standing in.
  if (!id || id === me.id) return;

  const db = getDb();
  await db
    .update(member)
    .set({ active: false })
    .where(
      and(eq(member.id, id), eq(member.companyId, me.companyId), isNull(member.erpUserId))
    );
  revalidatePath("/settings");
  revalidatePath("/inbox");
}

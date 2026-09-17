"use server";

// The Team module — one CENTRAL place to see everyone and assign which
// companies each person may read, across all companies at once (like the Phone
// Numbers module, not scoped to the company you happen to be standing in).
//
// Access to a company is an active member row (company x person); the ERP org
// sync creates them per ERP grant. Here an owner/admin adds EXTRA companies a
// person can read — the only way into a Connect-only company like Hookka. Extra
// grants are manual (erp_user_id null), which the org sync never deactivates, so
// they survive every sign-in; ERP-granted access is the base and is shown locked
// (the ERP decides it). One person = one row even though they hold a member row
// per company.

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

const GRANTABLE = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;
type Grantable = (typeof GRANTABLE)[number];
function cleanRole(v: string): Grantable {
  return (GRANTABLE as readonly string[]).includes(v) ? (v as Grantable) : "AGENT";
}

async function manager() {
  const me = await getCurrentMember();
  if (!me || (me.role !== "OWNER" && me.role !== "ADMIN")) return null;
  return me;
}

export interface TeamCompany {
  id: string;
  name: string;
}
export interface PersonAccess {
  companyId: string;
  memberId: string;
  role: string;
  /** From the ERP grant (locked here) vs a manual grant (removable here). */
  fromErp: boolean;
}
export interface Person {
  key: string;
  name: string;
  email: string;
  /** The role shown in the row's dropdown — applied to manual grants. */
  role: string;
  department: string | null;
  reportsTo: string | null;
  /** companyId -> access, only for companies the person can currently read. */
  access: Record<string, PersonAccess>;
}
export interface TeamView {
  permitted: boolean;
  companies: TeamCompany[];
  people: Person[];
}

export async function fetchTeam(): Promise<TeamView> {
  const me = await manager();
  if (!me) return { permitted: false, companies: [], people: [] };
  const db = getDb();

  const [companies, members, departments] = await Promise.all([
    db.query.company.findMany({
      columns: { id: true, name: true },
      where: eq(company.active, true),
      orderBy: (c, { asc }) => asc(c.createdAt),
    }),
    db.query.member.findMany({
      columns: {
        id: true,
        companyId: true,
        email: true,
        name: true,
        role: true,
        erpUserId: true,
        active: true,
        managerId: true,
        departmentId: true,
      },
    }),
    db.query.department.findMany({ columns: { id: true, name: true } }),
  ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));

  // One row per person, keyed by ERP user id when synced, else by email — the
  // same identity the sign-in upsert and sync reconcile on.
  const byKey = new Map<string, Person>();
  for (const m of members) {
    if (!m.active) continue;
    // Key by email — the identity that is stable across a person's ERP-synced
    // rows and any manual grants. Keying ERP rows separately (by erp_user_id)
    // split one person into two rows, so a grant made on the manual row never
    // showed on the ERP row the operator actually clicked.
    const key = m.email.toLowerCase();
    let p = byKey.get(key);
    if (!p) {
      p = {
        key,
        name: m.name,
        email: m.email,
        role: m.role,
        department: m.departmentId ? deptName.get(m.departmentId) ?? null : null,
        reportsTo: m.managerId ? memberName.get(m.managerId) ?? null : null,
        access: {},
      };
      byKey.set(key, p);
    }
    // Prefer a real name and the richest org detail from whichever row has it.
    if ((!p.name || p.name === p.email) && m.name) p.name = m.name;
    // The role dropdown edits manual grants, so a manual row's role wins for display.
    if (m.erpUserId == null) p.role = m.role;
    if (!p.department && m.departmentId) p.department = deptName.get(m.departmentId) ?? null;
    if (!p.reportsTo && m.managerId) p.reportsTo = memberName.get(m.managerId) ?? null;
    p.access[m.companyId] = {
      companyId: m.companyId,
      memberId: m.id,
      role: m.role,
      fromErp: m.erpUserId != null,
    };
  }

  const people = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { permitted: true, companies, people };
}

export async function setCompanyAccess(input: {
  email: string;
  name: string;
  role: string;
  companyId: string;
  on: boolean;
}): Promise<void> {
  const me = await manager();
  if (!me) return;
  const email = input.email.trim().toLowerCase();
  if (!email) return;
  const db = getDb();

  if (input.on) {
    const role = cleanRole(input.role);
    await db
      .insert(member)
      .values({ companyId: input.companyId, email, name: input.name || email, role })
      .onConflictDoUpdate({
        target: [member.companyId, member.email],
        set: { active: true, role },
      });
  } else {
    // Never let an admin remove their own access to the company they are standing
    // in — that is the one that would lock them out mid-action.
    if (email === me.email.toLowerCase() && input.companyId === me.companyId) return;
    // Only a manual grant (erp_user_id null) can be removed; the ERP owns its own
    // grants.
    await db
      .update(member)
      .set({ active: false })
      .where(
        and(
          eq(member.companyId, input.companyId),
          eq(member.email, email),
          isNull(member.erpUserId)
        )
      );
  }
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

export async function setPersonRole(input: { email: string; role: string }): Promise<void> {
  const me = await manager();
  if (!me) return;
  const email = input.email.trim().toLowerCase();
  const role = cleanRole(input.role);
  if (!email) return;
  const db = getDb();
  // Manual grants only — an ERP-synced member's role is the ERP's and is
  // overwritten on their next sign-in anyway.
  await db
    .update(member)
    .set({ role })
    .where(and(eq(member.email, email), isNull(member.erpUserId)));
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

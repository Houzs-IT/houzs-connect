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
import { bypassReadCache } from "@/db/fresh";
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
      // Fresh (db/fresh.ts): a grant made a moment ago must show at once — without
      // this Hyperdrive serves a stale snapshot for up to ~2 min, so a ticked box
      // reverts and looks like nothing happened.
      where: and(eq(company.active, true), bypassReadCache()),
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
      where: bypassReadCache(),
    }),
    db.query.department.findMany({
      columns: { id: true, name: true },
      where: bypassReadCache(),
    }),
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

// Both mutations take a FormData and run from a plain <form action={...}>. That
// is the app's standard, progressively-enhanced path — it posts and works even
// before (or without) client hydration, unlike an onChange + useTransition call,
// which left the matrix inert on the deployed page.

export async function toggleAccess(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = cleanRole(String(formData.get("role") ?? "AGENT"));
  const companyId = String(formData.get("companyId") ?? "");
  // The row's CURRENT state, submitted with the form: granted -> remove, else add.
  const on = String(formData.get("on") ?? "") === "1";
  if (!email || !companyId) return;
  const db = getDb();

  if (on) {
    // Never let an admin remove their own access to the company they are in.
    if (email === me.email.toLowerCase() && companyId === me.companyId) return;
    // Only a manual grant (erp_user_id null) can be removed; the ERP owns its own.
    await db
      .update(member)
      .set({ active: false })
      .where(and(eq(member.companyId, companyId), eq(member.email, email), isNull(member.erpUserId)));
  } else {
    await db
      .insert(member)
      .values({ companyId, email, name: name || email, role })
      .onConflictDoUpdate({
        target: [member.companyId, member.email],
        set: { active: true, role },
      });
  }
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

export async function setRoleForm(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = cleanRole(String(formData.get("role") ?? "AGENT"));
  if (!email) return;
  const db = getDb();
  // Manual grants only — an ERP-synced member's role is the ERP's, overwritten on
  // their next sign-in.
  await db
    .update(member)
    .set({ role })
    .where(and(eq(member.email, email), isNull(member.erpUserId)));
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

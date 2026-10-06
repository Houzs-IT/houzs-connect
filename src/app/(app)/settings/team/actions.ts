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
//
// Two decisions are Connect's own and outlive every ERP sync and sign-in
// (lib/team-access.ts): the role picked here wins over the ERP's, and a person
// who does not need Connect can be removed (and restored).

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ensureAccessTables } from "@/db/ensure-access";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { company, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { roleFromErp } from "@/lib/erp-auth";
import { photoSrcs } from "@/lib/member-photo";
import { isAdminRole } from "@/lib/permissions";

const GRANTABLE = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;
type Grantable = (typeof GRANTABLE)[number];
function cleanRole(v: string): Grantable {
  return (GRANTABLE as readonly string[]).includes(v) ? (v as Grantable) : "AGENT";
}

async function manager() {
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) return null;
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
  /** Profile photo URL (lib/member-photo.ts), or null. */
  photo: string | null;
  /** The role the ERP maps this person to (null when they are not in the ERP). */
  erpRole: string | null;
  /** The role was set here and wins over the ERP's. */
  roleSetHere: boolean;
}
/** Someone whose Connect access was removed. */
export interface RemovedPerson {
  email: string;
  name: string;
  removedBy: string | null;
  removedAt: string;
}
export interface TeamView {
  permitted: boolean;
  companies: TeamCompany[];
  people: Person[];
  removed: RemovedPerson[];
}

export async function fetchTeam(): Promise<TeamView> {
  const me = await manager();
  if (!me) return { permitted: false, companies: [], people: [], removed: [] };
  const db = getDb();
  await ensureAccessTables(db);

  const [companies, members, departments, overrides, removedRows] = await Promise.all([
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
        title: true,
      },
      where: bypassReadCache(),
    }),
    db.query.department.findMany({
      columns: { id: true, name: true },
      where: bypassReadCache(),
    }),
    db.execute(sql`select email from connect.role_override where ${bypassReadCache()}`) as unknown as Promise<{ email: string }[]>,
    db.execute(sql`
      select r.email, r.name, r.removed_at, b.name as removed_by
      from connect.access_removed r
      left join connect.member b on b.id = r.removed_by_member_id
      where ${bypassReadCache()}
      order by r.removed_at desc
    `) as unknown as Promise<{ email: string; name: string | null; removed_at: string; removed_by: string | null }[]>,
  ]);
  const setHere = new Set(overrides.map((o) => o.email));

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
        photo: null,
        erpRole: null,
        roleSetHere: setHere.has(key),
      };
      byKey.set(key, p);
    }
    if (m.erpUserId != null && !p.erpRole) p.erpRole = roleFromErp(m.title);
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

  // Most access first (Super Admin, Owner, Admin, …), then by name.
  const RANK = ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "AGENT", "SALES", "DRIVER"];
  const rank = (r: string) => (RANK.indexOf(r) < 0 ? RANK.length : RANK.indexOf(r));
  const people = [...byKey.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));

  // A photo belongs to the person, so any one of their member rows finds it.
  // Fresh, like every read here: an admin who just set one must see it.
  const anyRow = (p: Person) => Object.values(p.access)[0]?.memberId;
  const photos = await photoSrcs(people.map(anyRow), { fresh: true });
  for (const p of people) p.photo = photos.get(anyRow(p) ?? "") ?? null;

  const removed = removedRows.map((r) => ({
    email: r.email,
    name: r.name || r.email,
    removedBy: r.removed_by,
    removedAt: new Date(r.removed_at).toISOString(),
  }));
  return { permitted: true, companies, people, removed };
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
  const raw = String(formData.get("role") ?? "AGENT");
  if (!email) return;
  const db = getDb();
  // SUPER_ADMIN is added to the Role enum by migration 0013 (or here, at runtime);
  // role_override by 0021.
  await ensureAccessTables(db);

  // "Use the ERP role": forget the Connect choice; ERP rows take the ERP's role
  // back now (manual-only rows keep theirs — there is no ERP role for them).
  if (raw === "ERP") {
    const rs = await db.query.member.findMany({ where: eq(member.email, email) });
    if (rs.some((r) => r.role === "SUPER_ADMIN")) return;
    await db.execute(sql`delete from connect.role_override where email = ${email}`);
    for (const r of rs) {
      if (r.erpUserId != null) await db.update(member).set({ role: roleFromErp(r.title) }).where(eq(member.id, r.id));
    }
    revalidatePath("/settings/team");
    revalidatePath("/inbox");
    return;
  }

  const rows = await db.query.member.findMany({ where: eq(member.email, email) });
  const wasSuper = rows.some((r) => r.role === "SUPER_ADMIN");
  const supers = await db.query.member.findMany({ columns: { email: true }, where: sql`${member.role}::text = 'SUPER_ADMIN'` });
  const superEmails = new Set(supers.map((x) => x.email.toLowerCase()));

  if (raw === "SUPER_ADMIN" || wasSuper) {
    // Granting or removing SUPER_ADMIN is a Super Admin's call. The one
    // exception is the very first: with none in the system, an owner or admin
    // may name one, or nobody ever could.
    const allowed = me.role === "SUPER_ADMIN" || (raw === "SUPER_ADMIN" && superEmails.size === 0);
    if (!allowed) return;
    // Never leave the system without one.
    if (wasSuper && raw !== "SUPER_ADMIN" && superEmails.size <= 1) return;
    // SUPER_ADMIN is held on every one of the person's rows, ERP-synced ones
    // included — sign-in and the ERP sync keep it (login/actions.ts, erp-org.ts).
    await db
      .update(member)
      .set({ role: raw === "SUPER_ADMIN" ? "SUPER_ADMIN" : cleanRole(raw) })
      .where(eq(member.email, email));
    // A Super Admin stepped down keeps the role picked here, not the ERP's.
    if (raw === "SUPER_ADMIN") await db.execute(sql`delete from connect.role_override where email = ${email}`);
    else await saveOverride(email, cleanRole(raw), me.id);
  } else {
    // Every row, the ERP-synced ones too: the choice is remembered in
    // role_override, so the next ERP sync or sign-in keeps it.
    await db.update(member).set({ role: cleanRole(raw) }).where(eq(member.email, email));
    await saveOverride(email, cleanRole(raw), me.id);
  }
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

async function saveOverride(email: string, role: string, by: string) {
  await getDb().execute(sql`
    insert into connect.role_override (email, role, set_by_member_id) values (${email}, ${role}, ${by})
    on conflict (email) do update set role = excluded.role, set_by_member_id = excluded.set_by_member_id, set_at = now()
  `);
}

/**
 * Take someone out of Houzs Connect: every member row goes inactive, they
 * cannot sign in, an open session stops, and the ERP sync keeps them out.
 * Nothing is deleted — chats assigned to them stay assigned (reassign in
 * Service) and Restore puts back the rows that were active.
 */
export async function removeAccess(email: string): Promise<{ ok: boolean; error?: string }> {
  const me = await manager();
  if (!me) return { ok: false, error: "Only an admin can do this." };
  const target = email.trim().toLowerCase();
  if (!target) return { ok: false, error: "Not found." };
  if (target === me.email.toLowerCase()) return { ok: false, error: "You cannot remove your own access." };
  const db = getDb();
  await ensureAccessTables(db);
  const rs = await db.query.member.findMany({ where: and(eq(member.email, target), bypassReadCache()) });
  const live = rs.filter((r) => r.active);
  if (!live.length) return { ok: false, error: "Not found." };
  if (rs.some((r) => r.role === "SUPER_ADMIN") && me.role !== "SUPER_ADMIN") {
    return { ok: false, error: "Only a Super Admin can remove a Super Admin." };
  }
  await db.execute(sql`
    insert into connect.access_removed (email, name, member_ids, removed_by_member_id)
    values (${target}, ${live[0].name}, ${JSON.stringify(live.map((r) => r.id))}::jsonb, ${me.id})
    on conflict (email) do update set name = excluded.name, member_ids = excluded.member_ids,
      removed_by_member_id = excluded.removed_by_member_id, removed_at = now()
  `);
  await db.update(member).set({ active: false }).where(eq(member.email, target));
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Give Connect access back: the rows that were active (all of them when none
 * were recorded), and the ERP's (the next sync settles those).
 */
export async function restoreAccess(formData: FormData): Promise<void> {
  const me = await manager();
  if (!me) return;
  const target = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!target) return;
  const db = getDb();
  await ensureAccessTables(db);
  const r = (await db.execute(sql`
    delete from connect.access_removed where email = ${target} returning member_ids
  `)) as unknown as { member_ids: string[] }[];
  if (!r[0]) return;
  const ids = Array.isArray(r[0].member_ids) ? r[0].member_ids : [];
  await db.execute(sql`
    update connect.member set active = true
    where email = ${target} and (${ids.length === 0} or erp_user_id is not null or id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)))
  `);
  revalidatePath("/settings/team");
  revalidatePath("/inbox");
}

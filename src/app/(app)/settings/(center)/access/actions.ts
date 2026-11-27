"use server";

// Settings → Access (CONNECT-0003): which modules each person opens in the
// company the viewer is working in. The role gives every tick its starting
// point (lib/module-access.ts); a Super Admin changes any of them here, and only
// the ticks that differ from the role are stored (connect.module_access), so
// "Use role" simply forgets a person's choices. Super Admins always have every
// module and are shown locked.

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { ensureAccessTables } from "@/db/ensure-access";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { myModules } from "@/lib/full-access";
import { isModule, resolveModules, roleModules, type Module } from "@/lib/module-access";

export interface AccessPerson {
  email: string;
  name: string;
  role: string;
  modules: Module[];
  /** Some tick here differs from the role. */
  custom: boolean;
}
export interface AccessView {
  /** May open this page (has the company's settings). */
  permitted: boolean;
  /** May change ticks: a Super Admin. */
  canEdit: boolean;
  people: AccessPerson[];
}

export async function fetchAccess(): Promise<AccessView> {
  const me = await getCurrentMember();
  if (!me || !(await myModules()).includes("settings")) return { permitted: false, canEdit: false, people: [] };
  const db = getDb();
  await ensureAccessTables(db);
  const [members, choices] = await Promise.all([
    db.query.member.findMany({
      columns: { email: true, name: true, role: true },
      where: and(eq(member.companyId, me.companyId), eq(member.active, true), bypassReadCache()),
    }),
    db.execute(sql`
      select email, module, allowed from connect.module_access where company_id = ${me.companyId} and ${bypassReadCache()}
    `) as unknown as Promise<{ email: string; module: string; allowed: boolean }[]>,
  ]);
  const byEmail = new Map<string, { module: string; allowed: boolean }[]>();
  for (const c of choices) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c]);
  const RANK = ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"];
  const rank = (r: string) => (RANK.indexOf(r) < 0 ? RANK.length : RANK.indexOf(r));
  const people = members
    .map((m) => {
      const mine = byEmail.get(m.email.toLowerCase()) ?? [];
      const modules = resolveModules(m.role, mine);
      const base = roleModules(m.role);
      const custom = m.role !== "SUPER_ADMIN" && (modules.length !== base.length || modules.some((x) => !base.includes(x)));
      return { email: m.email, name: m.name, role: m.role, modules, custom };
    })
    .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
  return { permitted: true, canEdit: me.role === "SUPER_ADMIN", people };
}

async function editor() {
  const me = await getCurrentMember();
  return me?.role === "SUPER_ADMIN" ? me : null;
}

/** One tick: the row's current state is posted with it; it flips. */
export async function toggleModule(formData: FormData): Promise<void> {
  const me = await editor();
  if (!me) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const mod = String(formData.get("module") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  if (!email || !isModule(mod)) return;
  const db = getDb();
  await ensureAccessTables(db);
  const target = await db.query.member.findFirst({
    columns: { role: true },
    where: and(eq(member.companyId, me.companyId), sql`lower(${member.email}) = ${email}`, eq(member.active, true)),
  });
  // Super Admins always keep everything.
  if (!target || target.role === "SUPER_ADMIN") return;
  const want = !on;
  if (roleModules(target.role).includes(mod) === want) {
    // Back to what the role gives: nothing to remember.
    await db.execute(sql`delete from connect.module_access where company_id = ${me.companyId} and email = ${email} and module = ${mod}`);
  } else {
    await db.execute(sql`
      insert into connect.module_access (company_id, email, module, allowed, set_by_member_id)
      values (${me.companyId}, ${email}, ${mod}, ${want}, ${me.id})
      on conflict (company_id, email, module) do update set allowed = excluded.allowed, set_by_member_id = excluded.set_by_member_id, set_at = now()
    `);
  }
  revalidatePath("/settings/access");
}

/** "Use role": forget this person's ticks in this company. */
export async function resetAccess(formData: FormData): Promise<void> {
  const me = await editor();
  if (!me) return;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  const db = getDb();
  await ensureAccessTables(db);
  await db.execute(sql`delete from connect.module_access where company_id = ${me.companyId} and email = ${email}`);
  revalidatePath("/settings/access");
}

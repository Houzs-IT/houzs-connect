// Who opens which modules (CONNECT-0003), for the signed-in person in the
// company they are working in. The rules are lib/module-access.ts; the ticks a
// Super Admin set on Settings → Access live in connect.module_access. The menus
// show only these modules (Sidebar, MobileTabBar, SettingsMenu) and
// requireModule() turns a typed-in address away on the server.

import { cache } from "react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { ensureAccessTables } from "@/db/ensure-access";
import { getCurrentMember } from "@/lib/current-member";
import { homeFor, resolveModules, type Module } from "@/lib/module-access";

/** This person's saved ticks in one company. A missing table (before ensure ran) means none. */
export async function moduleChoices(companyId: string, email: string): Promise<{ module: string; allowed: boolean }[]> {
  try {
    const db = getDb();
    await ensureAccessTables(db);
    // Fresh (db/fresh.ts): a tick changed a moment ago must count on the next page.
    return (await db.execute(sql`
      select module, allowed from connect.module_access
      where company_id = ${companyId} and email = ${email.toLowerCase()} and ${bypassReadCache()}
    `)) as unknown as { module: string; allowed: boolean }[];
  } catch {
    return [];
  }
}

/** The modules the signed-in person may open here. Once per request. */
export const myModules = cache(async (): Promise<Module[]> => {
  const me = await getCurrentMember();
  if (!me) return [];
  return resolveModules(me.role, await moduleChoices(me.companyId, me.email));
});

/** For the layout or page of a module: someone without it goes to the first module they have. */
export async function requireModule(module: Module) {
  const me = await getCurrentMember();
  if (!me) redirect("/login");
  const mine = await myModules();
  if (!mine.includes(module)) redirect(homeFor(mine));
  return me;
}

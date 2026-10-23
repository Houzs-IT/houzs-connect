"use server";

import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";
import {
  STAFF_TABLES_DDL,
  STAGING_ROLE_NAMES,
  hashStaffPassword,
  newStaffPassword,
  type StagingRole,
} from "@/lib/staging-logins";

export type StagingLoginResult =
  | { ok: true; email: string; password: string; reset: boolean }
  | { ok: false; error: string };

/**
 * Create a staging sign-in, or give an existing one a new password. Refused
 * anywhere but the staging Worker: on production the ERP owns every password,
 * and public.users there is the ERP's own table.
 */
export async function createStagingLogin(input: {
  email: string;
  name: string;
  role: string;
}): Promise<StagingLoginResult> {
  if (getCloudflareContext().env.CONNECT_STAGING !== "1") {
    return { ok: false, error: "Staging logins can only be made on staging." };
  }
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) return { ok: false, error: "Only an owner or admin can do this." };

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim() || email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!(input.role in STAGING_ROLE_NAMES)) return { ok: false, error: "Choose a role." };
  const role = input.role as StagingRole;

  const db = getDb();
  for (const ddl of STAFF_TABLES_DDL) await db.execute(sql.raw(ddl));

  const password = newStaffPassword();
  const hash = await hashStaffPassword(password);
  const rows = (await db.execute(sql`
    with r as (
      insert into public.roles (name) values (${STAGING_ROLE_NAMES[role]})
      on conflict (name) do update set name = excluded.name
      returning id
    ), before as (
      select 1 from public.users where email = ${email}
    )
    insert into public.users (email, name, password_hash, status, role_id)
    select ${email}, ${name}, ${hash}, 'active', r.id from r
    on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash,
      status = 'active', role_id = excluded.role_id
    returning (select count(*) from before)::int as existed
  `)) as unknown as { existed: number }[];

  // Show the person on the Team page straight away, in the company sign-in uses.
  const home = (await db.execute(sql`
    select id from connect.company order by created_at asc limit 1
  `)) as unknown as { id: string }[];
  if (home[0]) {
    await db.execute(sql`
      insert into connect.member (id, company_id, name, email, role, title, active)
      values (${createId()}, ${home[0].id}, ${name}, ${email}, ${role}::"connect"."Role", ${STAGING_ROLE_NAMES[role]}, true)
      on conflict (company_id, email) do update set name = excluded.name, active = true,
        role = case when connect.member.role::text = 'SUPER_ADMIN' then connect.member.role else excluded.role end
    `);
  }

  revalidatePath("/settings/team");
  return { ok: true, email, password, reset: (rows[0]?.existed ?? 0) > 0 };
}

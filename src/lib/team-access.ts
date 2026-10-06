// Connect's own say over people the ERP syncs in (migration 0021).
//
// The ERP decides who exists, which companies they hold and their role — the
// org sync and every sign-in write those back onto connect.member. Two things
// an owner needs to decide in Connect instead, and keep through every sync:
//
//  - access_removed: a person who does not need Houzs Connect. Their member
//    rows go inactive, they cannot sign in, an open session stops working, and
//    the sync keeps them inactive. Keyed by lower-cased email (one person
//    across all their company rows). member_ids remembers which rows were
//    active, so Restore puts back exactly that.
//  - role_override: the Connect role an admin picked on the Team page, which
//    wins over the role mapped from the ERP on sync and sign-in. SUPER_ADMIN
//    is not stored here; it is sticky on its own.
//
// Tables are raw SQL like access_request (not in db/schema.ts), so a deploy
// that lands before they exist never breaks a `member` query.

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";

const rows = async <T,>(db: DB, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

/** True when this person's Connect access was removed. A missing table (before ensure ran) means no. */
export async function isAccessRemoved(db: DB, email: string): Promise<boolean> {
  try {
    const r = await rows<{ x: number }>(db, sql`select 1 as x from connect.access_removed where email = ${email.toLowerCase()} limit 1`);
    return r.length > 0;
  } catch {
    return false;
  }
}

/** The role an admin set in Connect for this person, if any. */
export async function roleOverride(db: DB, email: string): Promise<string | null> {
  try {
    const r = await rows<{ role: string }>(db, sql`select role from connect.role_override where email = ${email.toLowerCase()}`);
    return r[0]?.role ?? null;
  } catch {
    return null;
  }
}

/**
 * After an ERP sync: keep removed people inactive (the sync reactivates every
 * row it reaffirms) and put Connect-set roles back over the ERP's.
 */
export async function enforceTeamAccess(db: DB): Promise<void> {
  await db.execute(sql`
    update connect.member m set active = false
    where m.active and lower(m.email) in (select email from connect.access_removed)
  `);
  await db.execute(sql`
    update connect.member m set role = o.role::"connect"."Role"
    from connect.role_override o
    where lower(m.email) = o.email and m.role::text <> 'SUPER_ADMIN' and m.role::text <> o.role
  `);
}

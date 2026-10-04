import { sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";

/*
  Online status: connect.member.last_seen_at (migration 0010).

  Written when a signed-in member renders any page under (app) and by a
  once-a-minute heartbeat from an open, visible tab (PresencePing). Someone is
  "online" while that stamp is younger than ONLINE_WINDOW.

  Deliberately NOT a column in schema.ts's `member` table: Drizzle selects the
  full column list on every member read — login, getCurrentMember, the org
  sync — so a deploy that landed before the migration would take sign-in down
  with it. Read and written here with raw SQL instead; until the column exists
  everyone simply reads as offline.
*/

/** Online = seen within this many ms. Two heartbeats' worth. */
export const ONLINE_WINDOW_MS = 2 * 60_000;
/** Quiet longer than ONLINE_WINDOW_MS but less than this = "away"; past it, gone (as in the ERP). */
export const AWAY_WINDOW_MS = 15 * 60_000;
/** Don't rewrite the stamp more often than this. */
const WRITE_EVERY_S = 45;

let ensured: Promise<void> | null = null;

/** Memoised per isolate — ALTER TABLE takes a lock even as a no-op. */
function ensureColumn(db: DB): Promise<void> {
  if (!ensured) {
    ensured = db
      .execute(sql`ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone`)
      // The page a tab was last on, so "who's online" can say where (and link there).
      .then(() => db.execute(sql`ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "last_path" text`))
      .then(() => undefined)
      .catch((e) => {
        ensured = null; // never cache a failure
        throw e;
      });
  }
  return ensured;
}

/**
 * Stamp this member as seen now, and (from the heartbeat) the page they are on.
 * Never throws — presence must not break a page.
 */
export async function touchPresence(memberId: string, path: string | null = null): Promise<void> {
  try {
    const db = getDb();
    await ensureColumn(db);
    await db.execute(sql`
      UPDATE "connect"."member"
      SET "last_seen_at" = now(), "last_path" = COALESCE(${path}, "last_path")
      WHERE "id" = ${memberId}
        AND ("last_seen_at" IS NULL
          OR "last_seen_at" < now() - make_interval(secs => ${WRITE_EVERY_S})
          OR (${path}::text IS NOT NULL AND "last_path" IS DISTINCT FROM ${path}))
    `);
  } catch {
    // Column missing and not creatable (no privilege), or a transient error.
  }
}

export type Seen = { id: string; name: string; lastSeen: Date | null; online: boolean };

/** Every active member of a company with when they were last seen. */
export async function companyPresence(companyId: string): Promise<Seen[]> {
  const db = getDb();
  try {
    const rows = (await db.execute(sql`
      SELECT "id", "name", "last_seen_at" FROM "connect"."member"
      WHERE "company_id" = ${companyId} AND "active" = true
      ORDER BY "last_seen_at" DESC NULLS LAST, "name"
    `)) as unknown as { id: string; name: string; last_seen_at: string | Date | null }[];
    const now = Date.now();
    return rows.map((r) => {
      const lastSeen = r.last_seen_at ? new Date(r.last_seen_at) : null;
      return { id: r.id, name: r.name, lastSeen, online: !!lastSeen && now - lastSeen.getTime() < ONLINE_WINDOW_MS };
    });
  } catch {
    // Before migration 0010: no column yet, so nobody is known to be online.
    const rows = (await db.execute(sql`
      SELECT "id", "name" FROM "connect"."member"
      WHERE "company_id" = ${companyId} AND "active" = true ORDER BY "name"
    `)) as unknown as { id: string; name: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, lastSeen: null, online: false }));
  }
}

export type Active = { id: string; name: string; role: string; lastSeen: Date; lastPath: string | null };

/**
 * People of a company seen in the last 15 minutes, newest first — the ERP's
 * "who's online" list. Split into active / away by the caller.
 */
export async function recentPresence(companyId: string): Promise<Active[]> {
  try {
    const db = getDb();
    await ensureColumn(db);
    const since = new Date(Date.now() - AWAY_WINDOW_MS).toISOString();
    const rows = (await db.execute(sql`
      SELECT "id", "name", "role"::text AS "role", "last_seen_at", "last_path" FROM "connect"."member"
      WHERE "company_id" = ${companyId} AND "active" = true
        AND "last_seen_at" >= ${since}::timestamptz
      ORDER BY "last_seen_at" DESC
    `)) as unknown as { id: string; name: string; role: string; last_seen_at: string | Date; last_path: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, lastSeen: new Date(r.last_seen_at), lastPath: r.last_path }));
  } catch {
    return [];
  }
}

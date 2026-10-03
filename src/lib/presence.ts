import { sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";

/*
  Online status: connect.member.last_seen_at (migration 0009).

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
/** Don't rewrite the stamp more often than this. */
const WRITE_EVERY_S = 45;

let ensured: Promise<void> | null = null;

/** Memoised per isolate — ALTER TABLE takes a lock even as a no-op. */
function ensureColumn(db: DB): Promise<void> {
  if (!ensured) {
    ensured = db
      .execute(sql`ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone`)
      .then(() => undefined)
      .catch((e) => {
        ensured = null; // never cache a failure
        throw e;
      });
  }
  return ensured;
}

/** Stamp this member as seen now. Never throws — presence must not break a page. */
export async function touchPresence(memberId: string): Promise<void> {
  try {
    const db = getDb();
    await ensureColumn(db);
    await db.execute(sql`
      UPDATE "connect"."member" SET "last_seen_at" = now()
      WHERE "id" = ${memberId}
        AND ("last_seen_at" IS NULL OR "last_seen_at" < now() - make_interval(secs => ${WRITE_EVERY_S}))
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
    // Before migration 0009: no column yet, so nobody is known to be online.
    const rows = (await db.execute(sql`
      SELECT "id", "name" FROM "connect"."member"
      WHERE "company_id" = ${companyId} AND "active" = true ORDER BY "name"
    `)) as unknown as { id: string; name: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, lastSeen: null, online: false }));
  }
}

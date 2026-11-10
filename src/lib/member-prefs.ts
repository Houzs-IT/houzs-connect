import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { memberPref } from "@/db/schema";
import { ensureMemberPrefTable } from "@/db/ensure-member-pref";

/** Lower-cased, like member_photo — one person, one row across their companies. */
const key = (email: string) => email.trim().toLowerCase();

/**
 * The person's saved contacts columns (comma-joined keys), or null when they
 * have none / the table is not there yet. Guarded so a deploy before the
 * migration does not 500 the contacts page.
 */
export async function getMemberContactCols(db: DB, email: string): Promise<string | null> {
  try {
    await ensureMemberPrefTable(db);
    const row = await db.query.memberPref.findFirst({
      where: eq(memberPref.email, key(email)),
      columns: { contactsCols: true },
    });
    return row?.contactsCols ?? null;
  } catch {
    return null;
  }
}

/** Upsert the person's contacts columns. Best-effort: a failure must not break
 *  the toggle (the cookie already made it work on this browser). */
export async function saveMemberContactCols(db: DB, email: string, cols: string): Promise<void> {
  try {
    await ensureMemberPrefTable(db);
    await db
      .insert(memberPref)
      .values({ email: key(email), contactsCols: cols })
      .onConflictDoUpdate({
        target: memberPref.email,
        set: { contactsCols: cols, updatedAt: sql`now()` },
      });
  } catch {
    // ignore — per-browser cookie still holds the choice.
  }
}

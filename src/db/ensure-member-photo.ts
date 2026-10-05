// The staff profile-photo table, self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`. Migration 0015 is the record; these are its statements.
// Every caller treats a failure here as "nobody has a photo yet", so a missing
// table costs initials, never a page.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."member_photo" (
      "email" text PRIMARY KEY NOT NULL,
      "data" text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by" text
    )
  `);
}

export async function ensureMemberPhotoTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  await ensured;
}

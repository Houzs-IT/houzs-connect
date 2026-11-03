// The `resume_at` column reached the Drizzle schema (automationRun) before the
// live database. Drizzle selects the full column list on every read, so the
// moment `resume_at` exists in schema.ts but not in Postgres, every automation
// read 500s. Migration 0023 is the real fix; this makes a deploy that lands
// first survive, the same way src/db/ensure.ts does for the contact columns.
//
// It is called from the cron sweeper (src/lib/automation/sweeper.ts) before it
// touches automation_run.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate — ALTER TABLE takes an ACCESS EXCLUSIVE lock even as a
 *  no-op, so running it per sweep would serialise behind the table. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "connect"."automation_run" ADD COLUMN IF NOT EXISTS "resume_at" timestamp with time zone`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "automation_run_resume_idx" ON "connect"."automation_run" USING btree ("resume_at")`
  );
}

export async function ensureAutomationRunColumns(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a rejection
      throw e;
    });
  }
  await ensured;
}

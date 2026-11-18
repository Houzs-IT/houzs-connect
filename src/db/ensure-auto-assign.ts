// The auto-assignment settings table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project (production has never had it run past 0000). The webhook reads this
// table for every customer message that no automation took, and a missing table
// there must not cost a message — the caller also swallows failures. Same shape
// as ensure-auto-reply.ts and the other ensure* modules.
//
// A standalone table (not a column on member/conversation): a new column on
// those hot tables would 500 every read that Drizzle issues against them during
// the deploy-before-migrate window, but a new table is only ever touched behind
// this ensure, so it is safe to carry in schema.ts.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."auto_assign" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "enabled" boolean DEFAULT false NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by" text
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "auto_assign_company_key"
    ON "connect"."auto_assign" ("company_id")
  `);
}

export async function ensureAutoAssignTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null;
      throw e;
    });
  }
  await ensured;
}

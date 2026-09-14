// The auto-reply settings table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project (production has never had it run past 0000). The webhook reads this
// table for every customer message, and a missing table there must not cost a
// message — the caller also swallows failures. Same shape as the other ensure*
// modules. Migration 0007 is still the real fix.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."auto_reply" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "welcome_enabled" boolean DEFAULT false NOT NULL,
      "welcome_text" text DEFAULT '' NOT NULL,
      "welcome_after_hours" integer DEFAULT 24 NOT NULL,
      "away_enabled" boolean DEFAULT false NOT NULL,
      "away_text" text DEFAULT '' NOT NULL,
      "hours" jsonb,
      "timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
      "away_repeat_hours" integer DEFAULT 12 NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by" text
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "auto_reply_company_key"
    ON "connect"."auto_reply" ("company_id")
  `);
}

export async function ensureAutoReplyTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null;
      throw e;
    });
  }
  await ensured;
}

// The drip-campaign tables, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project (production has never had it run past 0000). The automation engine's
// add_to_drip node and the cron scheduler both touch these tables, so a missing
// table must not throw there. Same shape as the other ensure* modules; migration
// 0024 is still the real fix.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."drip_campaign" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "channel_id" text NOT NULL,
      "name" text NOT NULL,
      "status" text DEFAULT 'draft' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "drip_campaign_company_idx"
    ON "connect"."drip_campaign" ("company_id")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."drip_step" (
      "id" text PRIMARY KEY NOT NULL,
      "drip_id" text NOT NULL,
      "position" integer DEFAULT 0 NOT NULL,
      "after_unit" text DEFAULT 'days' NOT NULL,
      "after_amount" integer DEFAULT 0 NOT NULL,
      "template_name" text,
      "template_lang" text,
      "template_body" text,
      "remove_after_replied" boolean DEFAULT false NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "drip_step_drip_idx"
    ON "connect"."drip_step" ("drip_id")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."drip_enrollment" (
      "id" text PRIMARY KEY NOT NULL,
      "drip_id" text NOT NULL,
      "contact_id" text NOT NULL,
      "current_step" integer DEFAULT 0 NOT NULL,
      "status" text DEFAULT 'active' NOT NULL,
      "next_run_at" timestamp with time zone,
      "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "drip_enrollment_drip_idx"
    ON "connect"."drip_enrollment" ("drip_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "drip_enrollment_due_idx"
    ON "connect"."drip_enrollment" ("status", "next_run_at")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "drip_enrollment_contact_idx"
    ON "connect"."drip_enrollment" ("contact_id")
  `);
}

export async function ensureDripTables(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null;
      throw e;
    });
  }
  await ensured;
}

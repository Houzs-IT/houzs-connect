// The activity-log table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project, so a table that exists in schema.ts but not in Postgres would break
// every path that touches it. Writes go through logActivity (best-effort, so a
// miss is silent), but the READ — the Activity tab — needs the table to exist.
// Same shape and reasoning as ensure-conversation-member.ts. Migration 0027 is
// the canonical DDL; this is what makes the deploy that lands first work.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."activity_log" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "actor_member_id" text,
      "entity_type" text NOT NULL,
      "entity_id" text NOT NULL,
      "action" text NOT NULL,
      "detail" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "activity_log_company_idx"
    ON "connect"."activity_log" ("company_id", "created_at")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "activity_log_entity_idx"
    ON "connect"."activity_log" ("entity_type", "entity_id")
  `);
}

export async function ensureActivityLogTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a rejection
      throw e;
    });
  }
  await ensured;
}

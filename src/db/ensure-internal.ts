// The Internal chat tables, self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`, and Internal is a whole page that would otherwise error
// until someone runs it. Migration 0011 is the real record; this runs the same
// statements, all IF NOT EXISTS.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."internal_channel" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "kind" text DEFAULT 'channel' NOT NULL,
      "name" text NOT NULL,
      "topic" text,
      "department_id" text,
      "dm_key" text,
      "created_by_member_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "internal_channel_company_idx" ON "connect"."internal_channel" ("company_id")`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "internal_channel_dm_key" ON "connect"."internal_channel" ("company_id", "dm_key")`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."internal_channel_member" (
      "channel_id" text NOT NULL,
      "member_id" text NOT NULL,
      "last_read_at" timestamp with time zone,
      "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("channel_id", "member_id")
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "internal_channel_member_member_idx" ON "connect"."internal_channel_member" ("member_id")`
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."internal_message" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "author_member_id" text,
      "body" text DEFAULT '' NOT NULL,
      "parent_id" text,
      "also_in_channel" boolean DEFAULT false NOT NULL,
      "conversation_id" text,
      "system_action" jsonb,
      "mentions" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "edited_at" timestamp with time zone
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "internal_message_channel_idx" ON "connect"."internal_message" ("channel_id", "created_at")`
  );
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "internal_message_parent_idx" ON "connect"."internal_message" ("parent_id")`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "internal_message_conversation_idx" ON "connect"."internal_message" ("conversation_id")`
  );
}

export async function ensureInternalTables(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  return ensured;
}

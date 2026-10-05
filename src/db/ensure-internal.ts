// The Internal chat tables, self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`, and Internal is a whole page that would otherwise error
// until someone runs it. Migration 0012 is the real record; this runs the same
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
  // Channel membership (migration 0017). A channel is open (anyone in the
  // company joins) or needs approval; null = made before membership existed,
  // and data.ts settles its members once. A member row is a member or a
  // pending request, and an admin of the channel or not.
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "access" text`);
  // Which membership rule a channel was settled under (migration 0019): 2 =
  // department channels hold the department only, not every company admin.
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "settled" integer DEFAULT 0 NOT NULL`);
  // Channel info, like a WhatsApp group's (migration 0020): a photo, and what
  // members (not only admins) may do: edit the info, post, add people. Each
  // member can mute a channel; who joined / left / was added is logged.
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "icon" text`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_edit" text DEFAULT 'admins' NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_post" text DEFAULT 'all' NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_add" text DEFAULT 'admins' NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "muted" boolean DEFAULT false NOT NULL`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."internal_channel_event" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "actor_member_id" text,
      "action" text NOT NULL,
      "target_member_id" text,
      "detail" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "internal_channel_event_channel_idx" ON "connect"."internal_channel_event" ("channel_id", "created_at")`
  );
  await db.execute(sql`ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'member' NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "requested_at" timestamp with time zone`);
  // Who has been put in a department channel automatically (migration 0018,
  // lib/internal-auto-join.ts): once per (channel, person), so leaving sticks.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."internal_channel_auto" (
      "channel_id" text NOT NULL,
      "member_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("channel_id", "member_id")
    )
  `);
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

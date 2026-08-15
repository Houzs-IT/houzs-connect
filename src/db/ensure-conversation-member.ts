// The chat-members table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project, so a table that exists in schema.ts but not in Postgres takes down
// every path that touches it. Here that is the conversation page itself: the
// watchers are read as part of the conversation's own query, so a missing table
// is not a broken panel section, it is a 500 on the thread an agent is trying to
// answer. Same reasoning (and same shape) as ensureContactColumns in ensure.ts
// and ensureTemplateBindingTable in ensure-template-binding.ts.
//
// Migration 0005 is still the real fix; this is what makes the deploy that
// lands first survive.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/**
 * Memoised per isolate. CREATE TABLE IF NOT EXISTS still takes locks even when
 * it is a no-op, so running it per request would serialise every conversation
 * page behind a lock on the table it is trying to read.
 */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."conversation_member" (
      "id" text PRIMARY KEY NOT NULL,
      "conversation_id" text NOT NULL,
      "member_id" text NOT NULL,
      "added_by_member_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  // NON-partial: this is the ON CONFLICT target addChatMember inserts against,
  // and a bare ON CONFLICT will not match a partial index (42P10). It is also
  // what makes "add the same person twice" a no-op rather than a duplicate chip.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "conversation_member_conversation_member_key"
    ON "connect"."conversation_member" ("conversation_id", "member_id")
  `);
  // conversation_id leads the unique index above, so reads by conversation are
  // already covered; this one is for the reverse lookup.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "conversation_member_member_idx"
    ON "connect"."conversation_member" ("member_id")
  `);
}

export async function ensureConversationMemberTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      // Never cache a rejection, or one transient failure leaves this isolate
      // permanently broken.
      ensured = null;
      throw e;
    });
  }
  await ensured;
}

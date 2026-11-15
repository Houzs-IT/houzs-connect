// `conversation.closed_at` records WHEN a conversation was closed, so the
// dashboard can report resolution time (created -> closed). The conversation
// table carries no such timestamp otherwise (only created_at / last_message_at),
// and status is a current-state enum with no history.
//
// Kept OUT of the Drizzle schema on purpose — exactly like connect.message's
// `campaign_id` (see src/lib/campaign-messages.ts): Drizzle selects the full
// column list on every `query.conversation` read, so a column that is in the
// schema but not yet in Postgres would 500 every conversation read during the
// deploy-before-migrate window. So it is added idempotently here and read/written
// via raw SQL (the same approach as form.meta_flow_id and automation_run.resume_at).
//
// Forward-only: conversations closed before this column existed have NULL
// closed_at and are simply not counted in the resolution average.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate — ALTER TABLE takes an ACCESS EXCLUSIVE lock even as a
 *  no-op, so running it on every status change would serialise behind the table. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "connect"."conversation" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone`
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "conversation_closed_at_idx" ON "connect"."conversation" USING btree ("closed_at")`
  );
}

export async function ensureConversationClosedAt(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a rejection
      throw e;
    });
  }
  await ensured;
}

/**
 * Stamp (or clear) `closed_at` for one conversation to match a status change:
 * set to now when it becomes CLOSED, cleared otherwise so a reopened
 * conversation does not keep a stale close time. Ensures the column first, so
 * this is safe on a database that predates it. Raw SQL — the column is not in
 * the Drizzle schema (see the note above).
 */
export async function setConversationClosedAt(db: DB, conversationId: string, closed: boolean): Promise<void> {
  await ensureConversationClosedAt(db);
  await db.execute(
    sql`UPDATE "connect"."conversation" SET "closed_at" = ${closed ? new Date() : null} WHERE "id" = ${conversationId}`
  );
}

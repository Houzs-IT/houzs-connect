// The channel's phone number id, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project, and Drizzle selects the full column list on every read — so the moment
// `phone_number_id` is in schema.ts but not in Postgres, every path that reads a
// channel 500s. The dangerous one is the WhatsApp webhook: it is public, takes no
// session, and a failure there loses customer messages rather than showing an
// error page. Same reasoning (and same shape) as ensureContactColumns in
// ensure.ts and ensureConversationMemberTable in ensure-conversation-member.ts.
//
// Migration 0006 is still the real fix; this is what makes the deploy that lands
// first survive.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/**
 * Memoised per isolate. ALTER TABLE takes an ACCESS EXCLUSIVE lock even when it
 * is a no-op, so running it per request would put every webhook delivery behind
 * a lock on the table it is about to read.
 */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "connect"."channel" ADD COLUMN IF NOT EXISTS "phone_number_id" text`
  );
  // NON-partial: Postgres will not match a bare ON CONFLICT target to a partial
  // index (42P10). NULLs are distinct, so unassigned channels coexist.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "channel_phone_number_id_key"
    ON "connect"."channel" ("phone_number_id")
  `);
}

export async function ensureChannelColumns(db: DB): Promise<void> {
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

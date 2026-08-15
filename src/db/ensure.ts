// Columns that reached the Drizzle schema before the live database.
//
// Drizzle selects the full column list on every read, so the moment `blocked` /
// `updated_at` exist in schema.ts but not in Postgres, EVERY path that loads a
// contact row 500s — /inbox, /logs, /payments, /campaigns, and the WhatsApp
// webhook. The webhook one is the dangerous member of that list: it is a public
// endpoint with no session, so an auth-gated ensure cannot cover it, and a
// failure there means customer messages are lost, not just a broken page.
//
// So this lives on its own, takes no session, and is called from the webhook
// handler as well as the Contacts mutations. `pnpm db:migrate` (migration 0003)
// is still the real fix; this is what makes a deploy that lands first survive.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/**
 * Memoised per isolate. ALTER TABLE takes an ACCESS EXCLUSIVE lock even when it
 * is a no-op, so running it per request would put every webhook delivery behind
 * a lock on the table it is trying to write.
 */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "connect"."contact" ADD COLUMN IF NOT EXISTS "blocked" boolean DEFAULT false NOT NULL`
  );
  // Nullable, backfill, then NOT NULL — a straight `DEFAULT now() NOT NULL`
  // would claim every existing contact was edited at deploy time, on a column
  // the Contacts page sorts by.
  await db.execute(
    sql`ALTER TABLE "connect"."contact" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone`
  );
  await db.execute(
    sql`UPDATE "connect"."contact" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL`
  );
  await db.execute(
    sql`ALTER TABLE "connect"."contact" ALTER COLUMN "updated_at" SET DEFAULT now()`
  );
  await db.execute(
    sql`ALTER TABLE "connect"."contact" ALTER COLUMN "updated_at" SET NOT NULL`
  );
}

export async function ensureContactColumns(db: DB): Promise<void> {
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

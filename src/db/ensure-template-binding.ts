// The template-variable binding table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate` runs against the shared Supabase
// project, so a table that exists in schema.ts but not in Postgres takes down
// every path that touches it — here that is the Templates page AND campaign
// sending. Same reasoning (and same shape) as ensureContactColumns in ensure.ts
// and ensureAutomationVersionTable in app/(app)/automations/actions.ts.
//
// Migration 0004 is still the real fix; this is what makes the deploy that
// lands first survive.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/**
 * Memoised per isolate. CREATE TABLE IF NOT EXISTS still takes locks even when
 * it is a no-op, so running it per request would serialise every send behind a
 * lock on the table it is trying to read.
 */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."template_binding" (
      "id" text PRIMARY KEY NOT NULL,
      "company_id" text NOT NULL,
      "template_name" text NOT NULL,
      "language" text NOT NULL,
      "bindings" jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  // NON-partial: this is the ON CONFLICT target saveTemplateBinding upserts on,
  // and a bare ON CONFLICT will not match a partial index (42P10).
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "template_binding_company_template_key"
    ON "connect"."template_binding" ("company_id", "template_name", "language")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "template_binding_company_idx"
    ON "connect"."template_binding" ("company_id")
  `);
}

export async function ensureTemplateBindingTable(db: DB): Promise<void> {
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

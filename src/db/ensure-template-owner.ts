// The manual template-owner override table, self-applied at runtime.
//
// Connect deploys land before any migration runs against the shared Supabase
// project (deploy.yml ships the Worker only), so a table that exists in
// schema.ts but not in Postgres would take down the Templates page the moment
// it reads overrides. Same reasoning and shape as ensure-template-binding.ts
// and ensure-template-media.ts. Running CREATE TABLE as the Worker's own role
// also makes the table owned by that role, so the app can read/write it without
// a later GRANT (the trap the internal_attachment table hit).

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate — CREATE TABLE IF NOT EXISTS still takes a lock. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."template_owner" (
      "template_name" text PRIMARY KEY NOT NULL,
      "owner" text NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by" text
    )
  `);
}

export async function ensureTemplateOwnerTable(db: DB): Promise<void> {
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

// The template header-file table, self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`. Migration 0016 is the record; these are its statements.
// The send path treats a failure here as "this template has no header file",
// so a missing table costs the header, never the send.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

/** Memoised per isolate: CREATE … IF NOT EXISTS still takes locks. */
let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."template_media" (
      "id" text PRIMARY KEY NOT NULL,
      "waba_id" text NOT NULL,
      "template_name" text NOT NULL,
      "language" text NOT NULL,
      "format" text NOT NULL,
      "mime_type" text NOT NULL,
      "file_name" text NOT NULL,
      "data" text NOT NULL,
      "uploads" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_by" text
    )
  `);
  // NON-partial: the ON CONFLICT target saveTemplateMedia upserts on.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "template_media_template_key"
    ON "connect"."template_media" ("waba_id", "template_name", "language")
  `);
}

export async function ensureTemplateMediaTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  await ensured;
}

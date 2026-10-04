// notification_pref and api_key, self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`. Migration 0014 is the record; these are its statements.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"notification_pref\" (\n  \"member_id\" text NOT NULL,\n  \"kind\" text NOT NULL,\n  \"browser\" boolean DEFAULT true NOT NULL,\n  \"email\" boolean DEFAULT false NOT NULL,\n  \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  PRIMARY KEY (\"member_id\", \"kind\")\n)"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"api_key\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"company_id\" text NOT NULL,\n  \"name\" text NOT NULL,\n  \"prefix\" text NOT NULL,\n  \"hash\" text NOT NULL,\n  \"created_by_member_id\" text,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  \"last_used_at\" timestamp with time zone,\n  \"revoked_at\" timestamp with time zone\n)"));
  await db.execute(sql.raw("CREATE UNIQUE INDEX IF NOT EXISTS \"api_key_hash_key\" ON \"connect\".\"api_key\" (\"hash\")"));
  await db.execute(sql.raw("CREATE INDEX IF NOT EXISTS \"api_key_company_idx\" ON \"connect\".\"api_key\" (\"company_id\")"));
}

export async function ensureSettingsExtras(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  return ensured;
}

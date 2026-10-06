// SUPER_ADMIN, role_permission and access_request (0013), and access_removed
// and role_override (0021, lib/team-access.ts), self-applied at runtime.
//
// Same reason as the other ensure* modules: deploys land before
// `pnpm db:migrate`. Migration 0013 is the record; these are its statements,
// all IF NOT EXISTS.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql.raw("ALTER TYPE \"connect\".\"Role\" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"role_permission\" (\n  \"company_id\" text NOT NULL,\n  \"role\" text NOT NULL,\n  \"capability\" text NOT NULL,\n  \"allowed\" boolean NOT NULL,\n  \"updated_by_member_id\" text,\n  \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  PRIMARY KEY (\"company_id\", \"role\", \"capability\")\n)"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"access_request\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"company_id\" text NOT NULL,\n  \"name\" text NOT NULL,\n  \"email\" text NOT NULL,\n  \"phone\" text,\n  \"department\" text,\n  \"note\" text,\n  \"status\" text DEFAULT 'pending_manager' NOT NULL,\n  \"manager_member_id\" text,\n  \"manager_decided_at\" timestamp with time zone,\n  \"final_member_id\" text,\n  \"final_decided_at\" timestamp with time zone,\n  \"granted_role\" text,\n  \"granted_company_ids\" jsonb,\n  \"reject_reason\" text,\n  \"requester_ip\" text,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL\n)"));
  await db.execute(sql.raw("CREATE INDEX IF NOT EXISTS \"access_request_company_idx\" ON \"connect\".\"access_request\" (\"company_id\", \"status\")"));
  await db.execute(sql.raw("CREATE INDEX IF NOT EXISTS \"access_request_email_idx\" ON \"connect\".\"access_request\" (\"email\")"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"access_removed\" (\n  \"email\" text PRIMARY KEY NOT NULL,\n  \"name\" text,\n  \"member_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL,\n  \"removed_by_member_id\" text,\n  \"removed_at\" timestamp with time zone DEFAULT now() NOT NULL\n)"));
  await db.execute(sql.raw("CREATE TABLE IF NOT EXISTS \"connect\".\"role_override\" (\n  \"email\" text PRIMARY KEY NOT NULL,\n  \"role\" text NOT NULL,\n  \"set_by_member_id\" text,\n  \"set_at\" timestamp with time zone DEFAULT now() NOT NULL\n)"));
}

export async function ensureAccessTables(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  return ensured;
}

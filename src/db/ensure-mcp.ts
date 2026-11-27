// The AI Connector tables (migrations 0027 + 0028 + 0029), self-applied at runtime.
//
// Same reason as the other ensure* modules: production does not run
// `pnpm db:migrate` (tasks/HANDOFF.md §0). Migrations 0027 / 0028 / 0029 are the record; these
// are its statements, all IF NOT EXISTS. scripts/smoke-mcp.mjs checks the two
// stay in step.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

export const MCP_DDL: string[] = [
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_access\" (\n  \"email\" text PRIMARY KEY NOT NULL,\n  \"approved_by_member_id\" text,\n  \"approved_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_access_requests\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"email\" text NOT NULL,\n  \"member_id\" text,\n  \"company_id\" text,\n  \"name\" text,\n  \"reason\" text,\n  \"status\" text DEFAULT 'pending' NOT NULL,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  \"decided_by_member_id\" text,\n  \"decided_at\" timestamp with time zone\n)",
  "CREATE INDEX IF NOT EXISTS \"mcp_access_requests_status_idx\" ON \"connect\".\"mcp_access_requests\" (\"status\", \"created_at\")",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_oauth_clients\" (\n  \"client_id\" text PRIMARY KEY NOT NULL,\n  \"client_name\" text,\n  \"redirect_uris\" jsonb DEFAULT '[]'::jsonb NOT NULL,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_auth_requests\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"client_id\" text NOT NULL,\n  \"redirect_uri\" text NOT NULL,\n  \"state\" text,\n  \"code_challenge\" text NOT NULL,\n  \"expires_at\" timestamp with time zone NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_oauth_codes\" (\n  \"code_hash\" text PRIMARY KEY NOT NULL,\n  \"client_id\" text NOT NULL,\n  \"member_id\" text NOT NULL,\n  \"redirect_uri\" text NOT NULL,\n  \"code_challenge\" text NOT NULL,\n  \"expires_at\" timestamp with time zone NOT NULL,\n  \"used_at\" timestamp with time zone\n)",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_tokens\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"member_id\" text NOT NULL,\n  \"email\" text NOT NULL,\n  \"client_id\" text NOT NULL,\n  \"access_hash\" text NOT NULL,\n  \"access_expires_at\" timestamp with time zone NOT NULL,\n  \"refresh_hash\" text NOT NULL,\n  \"refresh_expires_at\" timestamp with time zone NOT NULL,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  \"last_used_at\" timestamp with time zone,\n  \"revoked_at\" timestamp with time zone\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"mcp_tokens_access_key\" ON \"connect\".\"mcp_tokens\" (\"access_hash\")",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"mcp_tokens_refresh_key\" ON \"connect\".\"mcp_tokens\" (\"refresh_hash\")",
  "CREATE INDEX IF NOT EXISTS \"mcp_tokens_email_idx\" ON \"connect\".\"mcp_tokens\" (\"email\")",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_calls\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"token_id\" text,\n  \"member_id\" text NOT NULL,\n  \"email\" text,\n  \"company_id\" text,\n  \"client_id\" text,\n  \"tool\" text NOT NULL,\n  \"target\" text,\n  \"status\" integer,\n  \"ok\" boolean NOT NULL,\n  \"note\" text,\n  \"ms\" integer,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS \"mcp_calls_created_idx\" ON \"connect\".\"mcp_calls\" (\"created_at\")",
  "CREATE INDEX IF NOT EXISTS \"mcp_calls_email_idx\" ON \"connect\".\"mcp_calls\" (\"email\", \"created_at\")",
  // Round 4b (migration 0028): the admin's action switches + pending proposals.
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_settings\" (\n  \"key\" text PRIMARY KEY NOT NULL,\n  \"enabled\" boolean DEFAULT false NOT NULL,\n  \"updated_by_member_id\" text,\n  \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_pending_actions\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"token_id\" text NOT NULL,\n  \"member_id\" text NOT NULL,\n  \"email\" text NOT NULL,\n  \"kind\" text NOT NULL,\n  \"payload\" jsonb,\n  \"summary\" text,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  \"expires_at\" timestamp with time zone NOT NULL,\n  \"used_at\" timestamp with time zone,\n  \"cancelled_at\" timestamp with time zone,\n  \"outcome_status\" integer,\n  \"outcome_note\" text\n)",
  "CREATE INDEX IF NOT EXISTS \"mcp_pending_actions_email_idx\" ON \"connect\".\"mcp_pending_actions\" (\"email\", \"used_at\")",
  // Round 4d (migration 0029): morning brief + urgent alerts — opt-ins, the debounce ledger, the send log.
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_brief_subscriptions\" (\n  \"member_id\" text PRIMARY KEY NOT NULL,\n  \"email\" text NOT NULL,\n  \"brief_enabled\" boolean DEFAULT false NOT NULL,\n  \"brief_time\" text DEFAULT '08:00' NOT NULL,\n  \"brief_days\" text DEFAULT 'weekdays' NOT NULL,\n  \"alerts_enabled\" boolean DEFAULT false NOT NULL,\n  \"unsub_token\" text NOT NULL,\n  \"last_alert_check_at\" timestamp with time zone,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE UNIQUE INDEX IF NOT EXISTS \"mcp_brief_subscriptions_unsub_key\" ON \"connect\".\"mcp_brief_subscriptions\" (\"unsub_token\")",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_proactive_keys\" (\n  \"member_id\" text NOT NULL,\n  \"alert_key\" text NOT NULL,\n  \"day\" text NOT NULL,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\n  PRIMARY KEY (\"member_id\", \"alert_key\", \"day\")\n)",
  "CREATE INDEX IF NOT EXISTS \"mcp_proactive_keys_day_idx\" ON \"connect\".\"mcp_proactive_keys\" (\"alert_key\", \"day\")",
  "CREATE TABLE IF NOT EXISTS \"connect\".\"mcp_proactive_sends\" (\n  \"id\" text PRIMARY KEY NOT NULL,\n  \"member_id\" text NOT NULL,\n  \"email\" text NOT NULL,\n  \"kind\" text NOT NULL,\n  \"day\" text NOT NULL,\n  \"items\" integer,\n  \"provider_id\" text,\n  \"status\" text NOT NULL,\n  \"note\" text,\n  \"created_at\" timestamp with time zone DEFAULT now() NOT NULL\n)",
  "CREATE INDEX IF NOT EXISTS \"mcp_proactive_sends_member_idx\" ON \"connect\".\"mcp_proactive_sends\" (\"member_id\", \"created_at\")",
];

let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  for (const stmt of MCP_DDL) await db.execute(sql.raw(stmt));
}

export async function ensureMcpTables(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  return ensured;
}

-- AI Connector round 4d: morning brief email + urgent alerts (owner 2026-11-26).
-- Everything is opt-in per person and OFF until the person turns it on in
-- Settings -> AI Connector.
--
--   mcp_brief_subscriptions  one row per member (per company) who saved the
--                            settings: brief on/off, time (HH:MM Malaysia),
--                            weekdays/daily, alerts on/off, the random token in
--                            each email's unsubscribe link, the last alert check.
--   mcp_proactive_keys       the debounce / idempotency ledger: one row per
--                            member + key + Malaysia day. "brief" is a key too,
--                            so a second tick cannot send a second brief
--                            (INSERT ... ON CONFLICT DO NOTHING RETURNING = the claim).
--   mcp_proactive_sends      the send log: who, which kind, how many items, the
--                            provider's message id, status. NEVER the body.
--
-- Additive, idempotent, no data. Also self-applied at runtime by
-- src/db/ensure-mcp.ts, because production does not run db:migrate.
-- REVERSAL: revert the code first, then
--   DROP TABLE IF EXISTS "connect"."mcp_proactive_sends", "connect"."mcp_proactive_keys", "connect"."mcp_brief_subscriptions";
CREATE TABLE IF NOT EXISTS "connect"."mcp_brief_subscriptions" (
  "member_id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "brief_enabled" boolean DEFAULT false NOT NULL,
  "brief_time" text DEFAULT '08:00' NOT NULL,
  "brief_days" text DEFAULT 'weekdays' NOT NULL,
  "alerts_enabled" boolean DEFAULT false NOT NULL,
  "unsub_token" text NOT NULL,
  "last_alert_check_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_brief_subscriptions_unsub_key" ON "connect"."mcp_brief_subscriptions" ("unsub_token");
CREATE TABLE IF NOT EXISTS "connect"."mcp_proactive_keys" (
  "member_id" text NOT NULL,
  "alert_key" text NOT NULL,
  "day" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("member_id", "alert_key", "day")
);
CREATE INDEX IF NOT EXISTS "mcp_proactive_keys_day_idx" ON "connect"."mcp_proactive_keys" ("alert_key", "day");
CREATE TABLE IF NOT EXISTS "connect"."mcp_proactive_sends" (
  "id" text PRIMARY KEY NOT NULL,
  "member_id" text NOT NULL,
  "email" text NOT NULL,
  "kind" text NOT NULL,
  "day" text NOT NULL,
  "items" integer,
  "provider_id" text,
  "status" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mcp_proactive_sends_member_idx" ON "connect"."mcp_proactive_sends" ("member_id", "created_at");
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houzs_connect') THEN
    FOREACH t IN ARRAY ARRAY['mcp_brief_subscriptions','mcp_proactive_keys','mcp_proactive_sends'] LOOP
      EXECUTE format('ALTER TABLE "connect".%I OWNER TO houzs_connect', t);
    END LOOP;
  END IF;
END $$;

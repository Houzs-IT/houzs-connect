-- AI Connector round 4b: write actions (owner approved 2026-11-26). The
-- connector stays read-only until the admin turns actions on, and then each
-- action still needs the person's own "yes" (propose → confirm_action).
--
--   mcp_settings         the admin's switches (Settings -> AI Connector): the
--                        main "Allow AI actions" switch and one per action, all
--                        OFF until turned on (a missing row = off).
--   mcp_pending_actions  one proposal waiting for the person's yes: single use,
--                        10 minutes, bound to the token and the person. The
--                        payload is dropped once it ran or was cancelled.
--
-- Additive, idempotent, no data. Also self-applied at runtime by
-- src/db/ensure-mcp.ts, because production does not run db:migrate.
-- REVERSAL: revert the code first, then
--   DROP TABLE IF EXISTS "connect"."mcp_pending_actions", "connect"."mcp_settings";
CREATE TABLE IF NOT EXISTS "connect"."mcp_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_by_member_id" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "connect"."mcp_pending_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "token_id" text NOT NULL,
  "member_id" text NOT NULL,
  "email" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb,
  "summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "outcome_status" integer,
  "outcome_note" text
);
CREATE INDEX IF NOT EXISTS "mcp_pending_actions_email_idx" ON "connect"."mcp_pending_actions" ("email", "used_at");
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houzs_connect') THEN
    FOREACH t IN ARRAY ARRAY['mcp_settings','mcp_pending_actions'] LOOP
      EXECUTE format('ALTER TABLE "connect".%I OWNER TO houzs_connect', t);
    END LOOP;
  END IF;
END $$;

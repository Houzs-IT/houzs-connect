-- AI Connector (MCP): staff connect Claude / ChatGPT to Houzs Connect with
-- THEIR OWN login, READ-ONLY, seeing only what that login sees; the owner
-- approves each person, sees every lookup and can disconnect anyone
-- (src/lib/mcp/*, src/app/api/mcp/*, Settings -> AI Connector).
--
--   mcp_access           who may connect (by email = the person, any company).
--   mcp_access_requests  "Request access" from the staff page; Approve / Reject.
--   mcp_oauth_clients    OAuth dynamic client registration (each AI app).
--   mcp_auth_requests    a pending "Allow?" screen (10 minutes).
--   mcp_oauth_codes      one-time authorization codes (PKCE S256), 10 minutes.
--   mcp_tokens           access + refresh tokens, SHA-256 hashes only.
--   mcp_calls            one row per AI lookup: who, which app, what, result.
--
-- Additive, idempotent, no data. Also self-applied at runtime by
-- src/db/ensure-mcp.ts, because production does not run db:migrate.
-- REVERSAL: revert the code first, then
--   DROP TABLE IF EXISTS "connect"."mcp_calls", "connect"."mcp_tokens",
--     "connect"."mcp_oauth_codes", "connect"."mcp_auth_requests",
--     "connect"."mcp_oauth_clients", "connect"."mcp_access_requests",
--     "connect"."mcp_access";
CREATE TABLE IF NOT EXISTS "connect"."mcp_access" (
  "email" text PRIMARY KEY NOT NULL,
  "approved_by_member_id" text,
  "approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "connect"."mcp_access_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "member_id" text,
  "company_id" text,
  "name" text,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by_member_id" text,
  "decided_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "mcp_access_requests_status_idx" ON "connect"."mcp_access_requests" ("status", "created_at");
CREATE TABLE IF NOT EXISTS "connect"."mcp_oauth_clients" (
  "client_id" text PRIMARY KEY NOT NULL,
  "client_name" text,
  "redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "connect"."mcp_auth_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "state" text,
  "code_challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS "connect"."mcp_oauth_codes" (
  "code_hash" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "member_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "connect"."mcp_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "member_id" text NOT NULL,
  "email" text NOT NULL,
  "client_id" text NOT NULL,
  "access_hash" text NOT NULL,
  "access_expires_at" timestamp with time zone NOT NULL,
  "refresh_hash" text NOT NULL,
  "refresh_expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_access_key" ON "connect"."mcp_tokens" ("access_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_refresh_key" ON "connect"."mcp_tokens" ("refresh_hash");
CREATE INDEX IF NOT EXISTS "mcp_tokens_email_idx" ON "connect"."mcp_tokens" ("email");
CREATE TABLE IF NOT EXISTS "connect"."mcp_calls" (
  "id" text PRIMARY KEY NOT NULL,
  "token_id" text,
  "member_id" text NOT NULL,
  "email" text,
  "company_id" text,
  "client_id" text,
  "tool" text NOT NULL,
  "target" text,
  "status" integer,
  "ok" boolean NOT NULL,
  "note" text,
  "ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "mcp_calls_created_idx" ON "connect"."mcp_calls" ("created_at");
CREATE INDEX IF NOT EXISTS "mcp_calls_email_idx" ON "connect"."mcp_calls" ("email", "created_at");
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houzs_connect') THEN
    FOREACH t IN ARRAY ARRAY['mcp_access','mcp_access_requests','mcp_oauth_clients','mcp_auth_requests','mcp_oauth_codes','mcp_tokens','mcp_calls'] LOOP
      EXECUTE format('ALTER TABLE "connect".%I OWNER TO houzs_connect', t);
    END LOOP;
  END IF;
END $$;

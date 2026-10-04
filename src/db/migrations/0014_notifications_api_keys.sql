-- Per-person notification choices, and API keys for other systems.
-- Also self-applied at runtime by src/db/ensure-settings-extras.ts.
CREATE TABLE IF NOT EXISTS "connect"."notification_pref" (
  "member_id" text NOT NULL,
  "kind" text NOT NULL,
  "browser" boolean DEFAULT true NOT NULL,
  "email" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("member_id", "kind")
);
CREATE TABLE IF NOT EXISTS "connect"."api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hash" text NOT NULL,
  "created_by_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_hash_key" ON "connect"."api_key" ("hash");
CREATE INDEX IF NOT EXISTS "api_key_company_idx" ON "connect"."api_key" ("company_id");

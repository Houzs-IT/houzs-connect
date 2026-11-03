-- Drip campaigns: a named, ordered sequence of template messages, each sent a
-- configured delay after the previous; contacts enrolled by the add_to_drip
-- automation node or from the inbox, advanced by the cron scheduler
-- (src/lib/drip.ts). Also self-applied at runtime by src/db/ensure-drip.ts,
-- because prod does not run db:migrate.
CREATE TABLE IF NOT EXISTS "connect"."drip_campaign" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drip_campaign_company_idx" ON "connect"."drip_campaign" USING btree ("company_id");

CREATE TABLE IF NOT EXISTS "connect"."drip_step" (
  "id" text PRIMARY KEY NOT NULL,
  "drip_id" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "after_unit" text DEFAULT 'days' NOT NULL,
  "after_amount" integer DEFAULT 0 NOT NULL,
  "template_name" text,
  "template_lang" text,
  "template_body" text,
  "remove_after_replied" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drip_step_drip_idx" ON "connect"."drip_step" USING btree ("drip_id");

CREATE TABLE IF NOT EXISTS "connect"."drip_enrollment" (
  "id" text PRIMARY KEY NOT NULL,
  "drip_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "next_run_at" timestamp with time zone,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drip_enrollment_drip_idx" ON "connect"."drip_enrollment" USING btree ("drip_id");
CREATE INDEX IF NOT EXISTS "drip_enrollment_due_idx" ON "connect"."drip_enrollment" USING btree ("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "drip_enrollment_contact_idx" ON "connect"."drip_enrollment" USING btree ("contact_id");

-- Version history for the automation flow builder. The app also self-applies
-- this table at runtime (ensureAutomationVersionTable in
-- app/(app)/automations/actions.ts) so a fresh deploy does not depend on this
-- migration having run — mirrors how Connect ensures its `connect` tables.
CREATE TABLE IF NOT EXISTS "connect"."automation_version" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"version" integer NOT NULL,
	"label" text,
	"status" text,
	"trigger_type" text,
	"trigger_config" jsonb,
	"graph" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_version_automation_idx" ON "connect"."automation_version" ("automation_id");

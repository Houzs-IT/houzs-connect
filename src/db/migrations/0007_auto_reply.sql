-- A company's automatic WhatsApp replies: a welcome for a customer who writes in
-- fresh, and an away message outside business hours.
--
-- WhatsApp's greeting and away messages are features of the Business APP. A
-- number on the Cloud API has neither, so the Houzs and Hookka numbers answered
-- nothing until a person did. One row per company; src/lib/auto-reply/ decides
-- when each is sent.
--
-- The app ALSO self-applies this DDL at runtime (ensureAutoReplyTable in
-- src/db/ensure-auto-reply.ts) so a deploy that lands before `pnpm db:migrate`
-- still works — mirrors 0003-0006. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

CREATE TABLE IF NOT EXISTS "connect"."auto_reply" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "welcome_enabled" boolean DEFAULT false NOT NULL,
  "welcome_text" text DEFAULT '' NOT NULL,
  "welcome_after_hours" integer DEFAULT 24 NOT NULL,
  "away_enabled" boolean DEFAULT false NOT NULL,
  "away_text" text DEFAULT '' NOT NULL,
  "hours" jsonb,
  "timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
  "away_repeat_hours" integer DEFAULT 12 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);
--> statement-breakpoint
-- NON-partial: the settings save upserts on company_id, and Postgres will not
-- match a bare ON CONFLICT target to a partial index (42P10).
CREATE UNIQUE INDEX IF NOT EXISTS "auto_reply_company_key"
  ON "connect"."auto_reply" ("company_id");

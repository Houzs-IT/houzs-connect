-- Internal chat attachments (images + files). Canonical, journaled migration.
--
-- Supersedes the earlier 0025_internal_attachment.sql, which was removed: it was
-- never in meta/_journal.json (so `db:migrate` ignored it) and it collided on the
-- 0025 number with 0025_payment_erp_sync. The table is also self-applied at
-- runtime by src/db/ensure-internal.ts, so the app works without this migration;
-- this file makes `db:migrate` create it too, and — the point of this migration —
-- hands ownership to houzs_connect.
--
-- The owner reassignment is the safeguard. The app connects as houzs_connect, so
-- a table it cannot read makes every /internal page 500 with "permission denied".
-- That happened in prod on 2026-11-03: the table ended up owned by postgres (a
-- db:migrate run as the postgres role) and houzs_connect had no SELECT. Running
-- this as a privileged role (postgres) hands it to houzs_connect; run as
-- houzs_connect it is a no-op. Guarded on the role existing so an environment
-- without a houzs_connect role (where this clause does not apply) is not broken.
CREATE TABLE IF NOT EXISTS "connect"."internal_attachment" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "company_id" text NOT NULL,
  "kind" text NOT NULL,
  "r2_key" text NOT NULL,
  "name" text NOT NULL,
  "mime" text NOT NULL,
  "size" integer NOT NULL,
  "width" integer,
  "height" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "internal_attachment_message_idx" ON "connect"."internal_attachment" ("message_id");
CREATE INDEX IF NOT EXISTS "internal_attachment_channel_idx" ON "connect"."internal_attachment" ("channel_id", "created_at");
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houzs_connect') THEN
    EXECUTE 'ALTER TABLE "connect"."internal_attachment" OWNER TO houzs_connect';
  END IF;
END $$;

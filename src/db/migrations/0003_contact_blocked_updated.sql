-- Contacts parity with Seampify: "Mark as Block" and a real "Updated At".
--
-- The app ALSO self-applies this DDL at runtime (ensureContactColumns in
-- app/(app)/contacts/actions.ts) so a deploy that lands before `pnpm db:migrate`
-- still renders — mirrors 0001/0002. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

ALTER TABLE "connect"."contact" ADD COLUMN IF NOT EXISTS "blocked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Added nullable, backfilled from created_at, and only then made NOT NULL
-- DEFAULT now(). A one-shot `DEFAULT now() NOT NULL` would stamp every
-- pre-existing contact as "updated" at deploy time — on a column the Contacts
-- table sorts by, that is a visible lie. The backfill only touches NULLs, so a
-- second run is a no-op rather than a reset.
ALTER TABLE "connect"."contact" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "connect"."contact" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "connect"."contact" ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "connect"."contact" ALTER COLUMN "updated_at" SET NOT NULL;

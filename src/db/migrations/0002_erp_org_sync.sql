-- ERP -> Connect org sync (one-way mirror over the ERP HTTP API).
--
-- The ERP `companies` / `users` masters are the sole source of truth; Connect
-- mirrors them so 2990 appears and members exist as conversation-assignment /
-- message-attribution identities. Connect never hand-edits this data.
--
-- The app ALSO self-applies this DDL at runtime (ensureErpOrgColumns in
-- src/lib/sync/erp-org.ts) so a fresh deploy does not depend on this migration
-- having run — mirrors how Connect ensures its `connect` tables elsewhere.
--
-- All statements are idempotent (IF EXISTS / IF NOT EXISTS) so re-running is safe.

-- connect.company: mirror companies.id / .code / .is_active.
ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "erp_company_id" integer;
--> statement-breakpoint
ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "code" text;
--> statement-breakpoint
ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- NON-partial on purpose: a bare ON CONFLICT (erp_company_id) target won't match
-- a partial index (Postgres 42P10). NULLs are distinct in a unique index, so
-- pre-sync seeded rows (null erp_company_id) still coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "company_erp_company_id_key"
  ON "connect"."company" ("erp_company_id");
--> statement-breakpoint

-- connect.member: mirror users.id, plus a soft-delete flag (never hard-delete).
ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "erp_user_id" integer;
--> statement-breakpoint
ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

-- Email is no longer globally unique — one ERP user fans out to one member per
-- granted company, so the same email recurs once per company. Uniqueness moves
-- to (company_id, email) [login upsert conflict target] and identity to
-- (company_id, erp_user_id).
ALTER TABLE "connect"."member" DROP CONSTRAINT IF EXISTS "member_email_unique";
--> statement-breakpoint
-- Both NON-partial: the login upsert conflicts on (company_id, email) and the
-- sync upsert on (company_id, erp_user_id) with BARE targets, which Postgres
-- won't match against a partial index (42P10). NULLs are distinct in a unique
-- index, so multiple null-email / null-erp_user_id rows per company still coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "member_company_email_unique"
  ON "connect"."member" ("company_id", "email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_company_erp_user_key"
  ON "connect"."member" ("company_id", "erp_user_id");

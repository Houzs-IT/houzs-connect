-- SUPER_ADMIN, an editable role x permission table per company, and access
-- requests from the sign-in page (department manager first, then a Super
-- Admin). Also self-applied at runtime by src/db/ensure-access.ts.
ALTER TYPE "connect"."Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
CREATE TABLE IF NOT EXISTS "connect"."role_permission" (
  "company_id" text NOT NULL,
  "role" text NOT NULL,
  "capability" text NOT NULL,
  "allowed" boolean NOT NULL,
  "updated_by_member_id" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("company_id", "role", "capability")
);
CREATE TABLE IF NOT EXISTS "connect"."access_request" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "department" text,
  "note" text,
  "status" text DEFAULT 'pending_manager' NOT NULL,
  "manager_member_id" text,
  "manager_decided_at" timestamp with time zone,
  "final_member_id" text,
  "final_decided_at" timestamp with time zone,
  "granted_role" text,
  "granted_company_ids" jsonb,
  "reject_reason" text,
  "requester_ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "access_request_company_idx" ON "connect"."access_request" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "access_request_email_idx" ON "connect"."access_request" ("email");

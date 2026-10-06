-- Connect's own say over people the ERP syncs in (src/lib/team-access.ts).
--
-- access_removed: people who do not need Houzs Connect. Their member rows stay
-- inactive through every ERP sync and they cannot sign in. member_ids holds
-- the rows that were active, for Restore.
-- role_override: the Connect role an admin set on the Team page; it wins over
-- the role mapped from the ERP on sync and sign-in.
--
-- Also self-applied at runtime by src/db/ensure-access.ts. Keep the two in step.

CREATE TABLE IF NOT EXISTS "connect"."access_removed" (
  "email" text PRIMARY KEY NOT NULL,
  "name" text,
  "member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "removed_by_member_id" text,
  "removed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "connect"."role_override" (
  "email" text PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "set_by_member_id" text,
  "set_at" timestamp with time zone DEFAULT now() NOT NULL
);

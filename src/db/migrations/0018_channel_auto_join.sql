-- New colleagues join their department's Internal channel automatically
-- (src/lib/internal-auto-join.ts). One row per (channel, person) who has been
-- put in a department channel that way, so it happens once: someone who
-- leaves the channel, or whom an admin removes, is not added again.
--
-- Also self-applied at runtime by src/db/ensure-internal.ts. Keep the two in step.

CREATE TABLE IF NOT EXISTS "connect"."internal_channel_auto" (
  "channel_id" text NOT NULL,
  "member_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("channel_id", "member_id")
);

-- Which membership rule an Internal channel was settled under.
--
-- 0 / 1: settled by the first rule (0017), which put every company admin in
-- every department channel. 2: the department only (owner, 2026-10-05). On
-- the next visit, internal/data.ts settleMembership takes the admins who are
-- not in the department, are not the channel's own admins and never posted
-- there out of department channels below 2, then marks them 2.
--
-- Also self-applied at runtime by src/db/ensure-internal.ts. Keep the two in step.

ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "settled" integer DEFAULT 0 NOT NULL;

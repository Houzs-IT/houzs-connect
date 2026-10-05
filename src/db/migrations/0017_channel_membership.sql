-- Internal channels get members, like a WhatsApp community's groups.
--
-- access: 'open' (anyone in the company joins by themselves) or 'approval'
-- (a request a channel admin or a company admin approves). Null marks a
-- channel made before membership existed; the app settles those once
-- (internal/data.ts settleMembership): a department channel keeps that
-- department plus the company's admins and needs approval, #general keeps
-- everyone and is open, any other channel keeps whoever already had it open.
--
-- internal_channel_member.state: 'member' or 'pending' (a request to join).
-- internal_channel_member.role: 'admin' (manages the channel) or 'member'.
--
-- Also self-applied at runtime by src/db/ensure-internal.ts. Keep the two in step.

ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "access" text;
ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'member' NOT NULL;
ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "requested_at" timestamp with time zone;

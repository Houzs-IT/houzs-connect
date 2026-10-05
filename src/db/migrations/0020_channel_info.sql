-- Internal channel info, like a WhatsApp group's.
--
-- internal_channel.icon: the channel's photo (a small JPEG as a data URL).
-- perm_edit / perm_post / perm_add: 'all' or 'admins' — who may edit the
--   channel's name, photo and description; who may send messages ('admins'
--   makes it an announcement channel); who may add people.
-- internal_channel_member.muted: no unread count or notifications for me.
-- internal_channel_event: who joined, asked, was added, approved, removed,
--   made admin, left; and info / permission changes. "Member changes".
--
-- Also self-applied at runtime by src/db/ensure-internal.ts. Keep the two in step.

ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "icon" text;
ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_edit" text DEFAULT 'admins' NOT NULL;
ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_post" text DEFAULT 'all' NOT NULL;
ALTER TABLE "connect"."internal_channel" ADD COLUMN IF NOT EXISTS "perm_add" text DEFAULT 'admins' NOT NULL;
ALTER TABLE "connect"."internal_channel_member" ADD COLUMN IF NOT EXISTS "muted" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "connect"."internal_channel_event" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_id" text NOT NULL,
  "actor_member_id" text,
  "action" text NOT NULL,
  "target_member_id" text,
  "detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "internal_channel_event_channel_idx" ON "connect"."internal_channel_event" ("channel_id", "created_at");

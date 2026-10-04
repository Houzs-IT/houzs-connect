-- Internal: staff-to-staff chat. Channels (one per department plus #general)
-- and direct messages, threads, @mentions, and a message may carry a linked
-- customer conversation shown as a card. Also self-applied at runtime by
-- src/db/ensure-internal.ts, so a deploy ahead of this migration still works.
CREATE TABLE IF NOT EXISTS "connect"."internal_channel" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "kind" text DEFAULT 'channel' NOT NULL,
  "name" text NOT NULL,
  "topic" text,
  "department_id" text,
  "dm_key" text,
  "created_by_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "internal_channel_company_idx" ON "connect"."internal_channel" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "internal_channel_dm_key" ON "connect"."internal_channel" ("company_id", "dm_key");
CREATE TABLE IF NOT EXISTS "connect"."internal_channel_member" (
  "channel_id" text NOT NULL,
  "member_id" text NOT NULL,
  "last_read_at" timestamp with time zone,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("channel_id", "member_id")
);
CREATE INDEX IF NOT EXISTS "internal_channel_member_member_idx" ON "connect"."internal_channel_member" ("member_id");
CREATE TABLE IF NOT EXISTS "connect"."internal_message" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_id" text NOT NULL,
  "author_member_id" text,
  "body" text DEFAULT '' NOT NULL,
  "parent_id" text,
  "also_in_channel" boolean DEFAULT false NOT NULL,
  "conversation_id" text,
  "system_action" jsonb,
  "mentions" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "edited_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "internal_message_channel_idx" ON "connect"."internal_message" ("channel_id", "created_at");
CREATE INDEX IF NOT EXISTS "internal_message_parent_idx" ON "connect"."internal_message" ("parent_id");
CREATE INDEX IF NOT EXISTS "internal_message_conversation_idx" ON "connect"."internal_message" ("conversation_id");

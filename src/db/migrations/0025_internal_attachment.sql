-- Internal chat attachments: the images and files a staff message carries,
-- WhatsApp-group style. The bytes live in the FILES R2 bucket (key in r2_key);
-- this row is the metadata the timeline renders and the serve route authorises.
-- One message may carry several. Also self-applied at runtime by
-- src/db/ensure-internal.ts, so a deploy ahead of this migration still works.
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

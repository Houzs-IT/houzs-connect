-- Which campaign sent a message, for the campaign read / replied stats and the
-- campaign detail page. Written and read by src/lib/campaign-messages.ts with
-- raw SQL (not in the Drizzle `message` definition, so a deploy ahead of this
-- migration cannot break message reads). Only campaigns sent after this ships
-- have per-message rows.
ALTER TABLE "connect"."message" ADD COLUMN IF NOT EXISTS "campaign_id" text;
CREATE INDEX IF NOT EXISTS "message_campaign_idx" ON "connect"."message" USING btree ("campaign_id");

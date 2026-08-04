-- Multi-tenant channels: each channel remembers its Meta WhatsApp Cloud API
-- phone-number id, so one Business + one token can serve many company numbers.
-- Inbound webhooks map value.metadata.phone_number_id -> channel -> company;
-- outbound sends use it as the /{phone_number_id}/messages path. NULL for a DEMO
-- channel with no live number yet. Unique so two companies can't claim one
-- number (NULLs are distinct in Postgres, so many DEMO/null channels coexist).
ALTER TABLE "connect"."channel" ADD COLUMN "phone_number_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_phone_number_id_key" ON "connect"."channel" USING btree ("phone_number_id");

-- Several WhatsApp numbers on one Business Account, each belonging to its own
-- company.
--
-- Until now the webhook filed every inbound message under the first company's
-- default channel and every send went out from the single WHATSAPP_PHONE_NUMBER_ID
-- secret, whichever number the customer had actually written to. A second number
-- (Hookka, +60 18-310 7133) on the same account would have put that company's
-- customers in Houzs Century's inbox and answered them from Houzs's number.
--
-- `phone_number_id` is Meta's id for the number a channel receives on and sends
-- from. The webhook maps value.metadata.phone_number_id -> channel -> company.
--
-- The app ALSO self-applies this DDL at runtime (ensureChannelColumns in
-- src/db/ensure-channel.ts) so a deploy that lands before `pnpm db:migrate`
-- still works — mirrors 0003/0004/0005. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

ALTER TABLE "connect"."channel" ADD COLUMN IF NOT EXISTS "phone_number_id" text;
--> statement-breakpoint
-- NON-partial on purpose: Postgres will not match a bare ON CONFLICT target to a
-- partial index (42P10). NULLs are distinct, so unassigned channels coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "channel_phone_number_id_key"
  ON "connect"."channel" ("phone_number_id");

-- The /forms "Publish" stores the published Meta WhatsApp Flow id here, so the
-- send_form automation node can send that flow to the customer
-- (src/lib/automation/engine.ts, src/lib/whatsapp/cloud-api.ts sendFlow).
ALTER TABLE "connect"."form" ADD COLUMN "meta_flow_id" text;

-- The Service panel and thread read a customer's automation runs by contact_id
-- (src/lib/automation/progress.ts), and dispatch.ts already filters runs by it
-- on every inbound message. Without an index each of those is a full scan of
-- automation_run, which grows by one row per flow per customer.
CREATE INDEX IF NOT EXISTS "automation_run_contact_idx" ON "connect"."automation_run" USING btree ("contact_id");

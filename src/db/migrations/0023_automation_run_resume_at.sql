-- When a run paused on a Delay node is due to resume. The scheduler
-- (src/lib/automation/sweeper.ts, driven by the cron tick) sweeps
-- `status='waiting' AND resume_at <= now()` and continues the run from the node
-- after the delay. Null for every other wait (button/text/form) and for
-- running/finished runs. Also self-applied at runtime by
-- src/db/ensure-automation-run.ts, because prod does not run db:migrate.
ALTER TABLE "connect"."automation_run" ADD COLUMN IF NOT EXISTS "resume_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "automation_run_resume_idx" ON "connect"."automation_run" USING btree ("resume_at");

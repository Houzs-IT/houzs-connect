-- Online status for the Dashboard: when each member was last active in Connect.
-- Written by src/lib/presence.ts (page renders + a one-minute heartbeat from an
-- open tab). Read with raw SQL there, not through the Drizzle `member` table, so
-- a deploy that lands before this migration cannot break member reads/sign-in.
ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

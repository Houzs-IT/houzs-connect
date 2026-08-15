-- Who is watching a conversation — Seampify's "Add Chat Members".
--
-- `conversation.assigned_agent_id` is single-valued and answers "who owns the
-- reply". It cannot also answer "who else was pulled in to help", which is why
-- the colleagues watching a thread are rows here rather than another column
-- there. Removing a watcher must not disturb the assignment, and reassigning
-- must not drop the watchers; two separate things, two separate stores.
--
-- The app ALSO self-applies this DDL at runtime (ensureConversationMemberTable
-- in src/db/ensure-conversation-member.ts) so a deploy that lands before
-- `pnpm db:migrate` still works — mirrors 0001/0002/0003/0004. Keep the two in
-- step.
--
-- Every statement is idempotent, so re-running is safe.

CREATE TABLE IF NOT EXISTS "connect"."conversation_member" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "member_id" text NOT NULL,
  "added_by_member_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NON-partial on purpose: this is the ON CONFLICT target addChatMember inserts
-- against, and Postgres will not match a bare ON CONFLICT to a partial index
-- (42P10). It is also what makes adding the same person twice a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_member_conversation_member_key"
  ON "connect"."conversation_member" ("conversation_id", "member_id");
--> statement-breakpoint
-- conversation_id leads the unique index above, so "the watchers of this
-- conversation" is already covered; this index is the reverse lookup.
CREATE INDEX IF NOT EXISTS "conversation_member_member_idx"
  ON "connect"."conversation_member" ("member_id");

-- What each {{n}} of a WhatsApp template is filled from.
--
-- Meta numbers template variables POSITIONALLY — {{1}}, {{2}}, {{3}} — and the
-- number says nothing about where the value comes from. Before this table the
-- send path looked "2" up as if it were a contact attribute, found nothing, and
-- sent "-". Every automated send of every one of the six submitted templates
-- delivered "Reference No. : -".
--
-- Keyed by (company, template name, language) because that triple is how Meta
-- identifies a template; there is no local template row to hang a column on.
--
-- The app ALSO self-applies this DDL at runtime (ensureTemplateBindingTable in
-- src/db/ensure-template-binding.ts) so a deploy that lands before
-- `pnpm db:migrate` still works — mirrors 0001/0002/0003. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

CREATE TABLE IF NOT EXISTS "connect"."template_binding" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "template_name" text NOT NULL,
  "language" text NOT NULL,
  "bindings" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NON-partial on purpose: this is the ON CONFLICT target the save action
-- upserts on, and Postgres will not match a bare ON CONFLICT to a partial
-- index (42P10).
CREATE UNIQUE INDEX IF NOT EXISTS "template_binding_company_template_key"
  ON "connect"."template_binding" ("company_id", "template_name", "language");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_binding_company_idx"
  ON "connect"."template_binding" ("company_id");

-- Staff profile photos.
--
-- One row per PERSON, keyed by lower-cased email: the ERP org sync fans one
-- person out to one member row per company, and the photo belongs to the
-- person, not to one of those rows. The browser crops and shrinks every photo
-- to a 256×256 JPEG before upload, so a row is tens of KB and is stored inline
-- (base64) — no bucket to provision. Served by app/api/member-photo/[id].
--
-- Also self-applied at runtime by src/db/ensure-member-photo.ts, so a deploy
-- that lands before `pnpm db:migrate` still works. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

CREATE TABLE IF NOT EXISTS "connect"."member_photo" (
  "email" text PRIMARY KEY NOT NULL,
  "data" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);

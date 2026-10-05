-- Template header files (image / PDF).
--
-- A template with an IMAGE or DOCUMENT header needs that file on EVERY send:
-- Meta keeps only the sample it reviewed, and refuses a send that does not
-- carry a header parameter. So the file chosen in the template editor is kept
-- here, one row per template (WABA + name + language), and the send path
-- uploads it to the sending number and attaches it.
--
-- Files are capped at 5 MB before encoding and stored inline (base64), the
-- same as connect.member_photo: no bucket to provision. `uploads` caches the
-- media id Meta returned per sending number ({ phoneId: { id, at } }), so a
-- campaign uploads the file once, not once per customer; Meta keeps a media id
-- for 30 days and the code re-uploads after 25.
--
-- Also self-applied at runtime by src/db/ensure-template-media.ts, so a deploy
-- that lands before `pnpm db:migrate` still works. Keep the two in step.
--
-- Every statement is idempotent, so re-running is safe.

CREATE TABLE IF NOT EXISTS "connect"."template_media" (
  "id" text PRIMARY KEY NOT NULL,
  "waba_id" text NOT NULL,
  "template_name" text NOT NULL,
  "language" text NOT NULL,
  "format" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_name" text NOT NULL,
  "data" text NOT NULL,
  "uploads" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "template_media_template_key"
  ON "connect"."template_media" ("waba_id", "template_name", "language");

// Types for the Cloudflare bindings surfaced via getCloudflareContext().env.
// Hand-authored (kept dependency-light); regenerate/extend with `wrangler types`
// once more bindings are added.

interface CloudflareEnv {
  // Hyperdrive binding -> Supabase Postgres (prod). Absent in local dev, where
  // DATABASE_URL from .dev.vars is used instead (see db/pg.ts resolveDatabaseUrl).
  HYPERDRIVE?: { connectionString: string };

  // Direct Postgres URL for local dev / scripts (from .dev.vars).
  DATABASE_URL?: string;

  // HMAC key for the signed session cookie (ERP-account login). Set as a
  // Worker secret in prod; in .dev.vars for local.
  SESSION_SECRET?: string;

  // WhatsApp transport (see src/lib/whatsapp/cloud-api.ts).
  WHATSAPP_MODE?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
}

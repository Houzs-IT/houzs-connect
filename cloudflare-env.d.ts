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
  /** WhatsApp Business Account id — needed to list/create message templates. */
  WHATSAPP_WABA_ID?: string;

  // ERP org sync (see src/lib/sync/erp-org.ts + app/api/admin/sync-org).
  // ERP_API_BASE defaults to https://erp.houzscentury.com when unset.
  ERP_API_BASE?: string;
  // Shared Bearer token the ERP treats as a fail-open service user.
  ERP_SERVICE_TOKEN?: string;
  // Guards POST /api/admin/sync-org (x-sync-token header must equal this).
  SYNC_ADMIN_TOKEN?: string;
}

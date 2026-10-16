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

  // "1" on PR previews and staging: no Meta token, no call_rest_api.
  CONNECT_PREVIEW?: string;
  // "1" on the staging Worker only: shows the STAGING strip.
  CONNECT_STAGING?: string;

  // ERP org sync (see src/lib/sync/erp-org.ts + app/api/admin/sync-org).
  // ERP_API_BASE defaults to https://erp.houzscentury.com when unset.
  ERP_API_BASE?: string;
  // Shared Bearer token the ERP treats as a fail-open service user.
  ERP_SERVICE_TOKEN?: string;
  // Guards POST /api/admin/sync-org (x-sync-token header must equal this).
  SYNC_ADMIN_TOKEN?: string;

  // Shared secrets for the inbound automation webhooks (see src/lib/webhook-auth.ts).
  // Callers send them as `x-connect-key` or `Authorization: Bearer`.
  ERP_WEBHOOK_SECRET?: string; // POST /api/webhooks/erp
  DRIVER_WEBHOOK_SECRET?: string; // POST /api/webhooks/driver

  // OUTBOUND to the ERP: the delivery flows' call_rest_api nodes send this as
  // X-Chat-Key to {callback_url} (the ERP's /api/chat-callback). Must equal the
  // ERP worker's CHAT_CALLBACK_KEY. Referenced from a flow header as
  // `{secret:ERP_CALLBACK_KEY}` (see src/lib/automation/rest.ts); never an
  // attribute, never in a body.
  ERP_CALLBACK_KEY?: string;

  // Service Binding to the ERP worker (autocount-sync-api, same account). The
  // automation engine's call_rest_api uses it for erp.houzscentury.com instead
  // of a network fetch — see src/lib/automation/rest.ts RestBindings for why.
  ERP?: { fetch: (input: string | Request, init?: RequestInit) => Promise<Response> };

  // IT Support (src/lib/it-support/hub.ts): the Houzs IT Hub's origin (a [vars]
  // entry) and Connect's key for it (`wrangler secret put IT_HUB_API_KEY`). Either
  // unset => IT Support is off: no menu entry, and /it-support says so.
  IT_HUB_URL?: string;
  IT_HUB_API_KEY?: string;
}

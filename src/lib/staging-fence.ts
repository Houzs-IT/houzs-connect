// The fence around staging, as pure decisions (no env, no network) so
// scripts/smoke-staging-fence.mjs can pin them. src/lib/staging.ts reads the
// Worker env and calls these.
//
// Staging (houzs-connect-staging) runs WHATSAPP_MODE=LIVE on the company's real
// Meta token and number so a tester's phone receives the real templates. What
// keeps that from reaching a customer or changing the live account:
//   - a send goes only to a phone on STAGING_ALLOWED_PHONES (empty = none);
//   - call_rest_api reaches only the ERP staging Worker, never production or a
//     live Google Sheet;
//   - nothing that CHANGES the WhatsApp account (templates, numbers, business
//     profile, Flows) is sent to Meta.
// Production relays a tester's replies to staging (relayToStaging), because
// Meta delivers every reply for the number to production's webhook.

/** Where production forwards a tester's deliveries. Fixed here, not an env
 *  var: production must never be configurable into posting WhatsApp traffic to
 *  an arbitrary address. */
export const STAGING_WEBHOOK_URL = "https://houzs-connect-staging.houzs-erp.workers.dev/api/webhooks/whatsapp";

/** The ERP staging Worker, by both of its addresses. The ERP's callback_url is
 *  PUBLIC_APP_URL (the Pages host), which routes /api/* to the same Worker. */
export const STAGING_REST_HOSTS = [
  "houzs-erp-staging.pages.dev",
  "autocount-sync-api-staging.houzs-erp.workers.dev",
];

/** Digits only, Malaysian local "01x…" as "601x…" — the form Connect stores. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("0") ? `6${digits}` : digits;
}

/** "60123456789, +60 19-876 5432" → a set of normalised numbers. Commas,
 *  semicolons or new lines separate; spaces inside a number are formatting. */
export function parsePhoneList(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[,;\n]+/)) {
    const p = normalisePhone(part);
    if (p.length >= 8) out.add(p);
  }
  return out;
}

/** Why a send to `to` must not happen, or null when it may. A WhatsApp
 *  username (no digits-only address) is refused on staging: it cannot be on
 *  the list. */
export function recipientRefusal(to: string, staging: boolean, allowed: Set<string>): string | null {
  if (!staging) return null;
  if (/^\d+$/.test(to) && allowed.has(normalisePhone(to))) return null;
  return `Staging sends only to the test numbers in STAGING_ALLOWED_PHONES; ${to || "this recipient"} is not one of them.`;
}

/** Why a call_rest_api URL must not be called, or null when it may. */
export function restUrlRefusal(url: string, staging: boolean): string | null {
  if (!staging) return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null; // callRestApi reports the bad URL itself
  }
  if (STAGING_REST_HOSTS.includes(host)) return null;
  return `staging calls only the ERP staging Worker, not ${host}`;
}

/** Why a Graph request must not be sent, or null when it may. Reads are fine;
 *  every write to the account (POST / DELETE) is refused on staging. */
export function metaWriteRefusal(method: string | undefined, staging: boolean): string | null {
  if (!staging) return null;
  const m = (method ?? "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return null;
  return "Staging does not change the WhatsApp account (templates, numbers, profile, Flows). Do this on chat.houzscentury.com.";
}

interface DeliveryShape {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; from_user_id?: string }[];
        statuses?: { recipient_id?: string; recipient_user_id?: string }[];
      };
    }[];
  }[];
}

/** Whether production should forward this delivery to staging instead of
 *  handling it: every message in it is FROM, and every status in it is TO, a
 *  tester's phone. A delivery that touches anyone else stays in production
 *  whole — a customer's message is never diverted. */
export function relayToStaging(body: unknown, relayPhones: Set<string>): boolean {
  if (relayPhones.size === 0) return false;
  const parties: string[] = [];
  for (const entry of (body as DeliveryShape | null)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      for (const m of v?.messages ?? []) parties.push(m.from ?? m.from_user_id ?? "");
      for (const s of v?.statuses ?? []) parties.push(s.recipient_id ?? s.recipient_user_id ?? "");
    }
  }
  return parties.length > 0 && parties.every((p) => /^\d+$/.test(p) && relayPhones.has(normalisePhone(p)));
}

// Shared-secret check for the inbound automation webhooks (/api/webhooks/erp and
// /api/webhooks/driver).
//
// Without it, anyone who knows https://chat.houzscentury.com/api/webhooks/erp can
// POST a phone number and an automation name: the contact is upserted and the
// automation runs, which in LIVE sends real WhatsApp messages to that number.
//
// The caller sends the secret as either header:
//   x-connect-key: <secret>
//   Authorization: Bearer <secret>
// WebCrypto, because this runs in a Cloudflare Worker.

export type WebhookAuth = "ok" | "unauthorized" | "unconfigured";

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * Compare without leaking where the first difference is — or the secret's length:
 * both sides are hashed first, so the loop always runs over 32 bytes.
 */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** The key the caller presented, from `x-connect-key` or `Authorization: Bearer`. */
export function presentedKey(headers: Headers): string | null {
  const direct = headers.get("x-connect-key")?.trim();
  if (direct) return direct;
  const auth = headers.get("authorization")?.trim();
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Decide whether a webhook call may proceed.
 *
 * With no secret configured the route FAILS CLOSED unless WhatsApp is explicitly in
 * DEMO (local dev, PR previews), where nothing reaches a customer. A missing secret
 * on the LIVE Worker must not quietly reopen the endpoint.
 */
export async function webhookAuth(
  headers: Headers,
  secret: string | undefined,
  whatsappMode: string | undefined
): Promise<WebhookAuth> {
  if (!secret) return whatsappMode === "DEMO" ? "ok" : "unconfigured";
  const key = presentedKey(headers);
  if (!key) return "unauthorized";
  return (await sameSecret(key, secret)) ? "ok" : "unauthorized";
}

// Proof that a webhook delivery came from Meta.
//
// Meta signs every delivery: `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256
// of the raw request body keyed with the app secret. Without checking it, anyone
// who knows https://chat.houzscentury.com/api/webhooks/whatsapp can post a
// "customer message": it lands in an inbox, and with auto replies on, the system
// answers it. WebCrypto, because this runs in a Cloudflare Worker.

export type SignatureState = "valid" | "invalid" | "absent" | "off";

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare without leaking where the first difference is. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signatureState(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined
): Promise<SignatureState> {
  if (!appSecret) return "off";
  if (!header || !header.startsWith("sha256=")) return "absent";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return sameText(hex(mac), header.slice("sha256=".length).toLowerCase()) ? "valid" : "invalid";
}

/**
 * Whether an unverified delivery must be refused.
 *
 * Enforcement ARMS ITSELF on the first delivery that verifies. Until then a
 * failing signature is let through and flagged: a secret pasted wrong would
 * otherwise reject every real customer message, silently, from the moment it
 * was set. Once one real delivery has proven the secret right, anything that
 * does not verify is refused.
 */
export function mustRefuse(state: SignatureState, armed: boolean): boolean {
  return armed && (state === "invalid" || state === "absent");
}

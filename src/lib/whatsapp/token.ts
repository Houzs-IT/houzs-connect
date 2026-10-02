/**
 * The Meta (WhatsApp Cloud API) access token — or nothing, on a PR preview.
 *
 * PR previews (.github/workflows/preview.yml) run as non-production versions of
 * the same Worker, so they inherit its secrets, WHATSAPP_TOKEN included. They
 * set WHATSAPP_MODE=DEMO, but DEMO only stubs message sends: template
 * submission, phone-number and profile edits, and media uploads read the token
 * directly. Every token read goes through here so a preview (CONNECT_PREVIEW=1)
 * behaves as "WhatsApp not connected" and can never call Meta.
 */
export function metaToken(): string | undefined {
  if (process.env.CONNECT_PREVIEW === "1") return undefined;
  return process.env.WHATSAPP_TOKEN || undefined;
}

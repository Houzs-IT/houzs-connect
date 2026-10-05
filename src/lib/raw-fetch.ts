/**
 * The Workers runtime's own fetch, not Next.js's patched one.
 *
 * Inside the Connect Worker, an outbound call made through Next's fetch wrapper
 * (which rebuilds the request for its data cache) can come back as a bare 400 —
 * no body, no headers — without ever leaving Cloudflare. First seen on the
 * Anthropic receipt call (#74); seen again on the automation engine's
 * call_rest_api POST to the ERP's /api/chat-callback (2026-10-05: Connect logged
 * "HTTP 400" with an empty response while the ERP worker's live tail showed no
 * request at all). Next keeps the unpatched fetch on `_nextOriginalFetch`; fall
 * back to the global one if that ever goes away (plain runtime, scripts, tests).
 *
 * Use this for every server-to-server call that is not a Next data fetch.
 */
export function rawFetch(): typeof fetch {
  const g = globalThis.fetch as typeof fetch & { _nextOriginalFetch?: typeof fetch };
  return g._nextOriginalFetch ?? g;
}

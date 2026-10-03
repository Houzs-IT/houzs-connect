// Pure smoke for the shared-secret check on /api/webhooks/erp and
// /api/webhooks/driver (no DB, no network).
//
// Without this check anyone who knows the URL can make the LIVE Worker message an
// arbitrary phone number, so the cases that matter most are the refusals.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { webhookAuth, presentedKey } = await import("../src/lib/webhook-auth.ts");

const secret = "test-webhook-secret";
const h = (init) => new Headers(init);

// The right key, either header.
assert((await webhookAuth(h({ "x-connect-key": secret }), secret, "LIVE")) === "ok", "x-connect-key with the right secret passes");
assert((await webhookAuth(h({ authorization: `Bearer ${secret}` }), secret, "LIVE")) === "ok", "Authorization: Bearer with the right secret passes");
assert((await webhookAuth(h({ authorization: `bearer  ${secret} ` }), secret, "LIVE")) === "ok", "the Bearer scheme is case-insensitive and whitespace-tolerant");

// Wrong or missing key.
assert((await webhookAuth(h({}), secret, "LIVE")) === "unauthorized", "no key is refused");
assert((await webhookAuth(h({ "x-connect-key": "wrong" }), secret, "LIVE")) === "unauthorized", "a wrong key is refused");
assert((await webhookAuth(h({ "x-connect-key": secret + "x" }), secret, "LIVE")) === "unauthorized", "a key with a suffix is refused");
assert((await webhookAuth(h({ "x-connect-key": secret.slice(0, -1) }), secret, "LIVE")) === "unauthorized", "a prefix of the key is refused");
assert((await webhookAuth(h({ authorization: secret }), secret, "LIVE")) === "unauthorized", "a bare Authorization value without Bearer is refused");
assert((await webhookAuth(h({ authorization: `Basic ${secret}` }), secret, "LIVE")) === "unauthorized", "another auth scheme is refused");
assert((await webhookAuth(h({ "x-connect-key": "wrong" }), secret, "DEMO")) === "unauthorized", "once a secret is set it is enforced in DEMO too");

// No secret configured: fail closed unless explicitly DEMO.
assert((await webhookAuth(h({ "x-connect-key": "anything" }), undefined, "LIVE")) === "unconfigured", "LIVE with no secret refuses everything");
assert((await webhookAuth(h({}), "", "LIVE")) === "unconfigured", "an empty secret counts as not configured");
assert((await webhookAuth(h({}), undefined, undefined)) === "unconfigured", "an unset WHATSAPP_MODE fails closed");
assert((await webhookAuth(h({}), undefined, "DEMO")) === "ok", "DEMO with no secret stays open for local dev and previews");

assert(presentedKey(h({ "x-connect-key": "a", authorization: "Bearer b" })) === "a", "x-connect-key wins over Authorization");
assert(presentedKey(h({})) === null, "no header means no key");

console.log("smoke-webhook-auth: all assertions passed");

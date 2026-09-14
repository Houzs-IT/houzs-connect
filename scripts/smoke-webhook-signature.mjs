// Pure smoke for Meta webhook signature checking (no DB, no network).
//
// The expected MAC is computed here with node:crypto, independently of the
// WebCrypto code under test, so the two can only agree if the check is right.

import { createHmac } from "node:crypto";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { signatureState, mustRefuse } = await import("../src/lib/whatsapp/signature.ts");

const secret = "test-app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1" }] });
const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

assert((await signatureState(body, good, secret)) === "valid", "Meta's own signature verifies");
assert((await signatureState(body, good.toUpperCase().replace("SHA256=", "sha256="), secret)) === "valid", "hex case does not matter");
assert((await signatureState(body + " ", good, secret)) === "invalid", "a body changed by one byte does not verify");
assert((await signatureState(body, good, "another-secret")) === "invalid", "the wrong secret does not verify");
assert((await signatureState(body, null, secret)) === "absent", "a delivery with no signature is absent");
assert((await signatureState(body, "sha1=abc", secret)) === "absent", "a non-sha256 header counts as absent");
assert((await signatureState(body, good, undefined)) === "off", "no secret configured means the check is off");

assert(mustRefuse("invalid", true) && mustRefuse("absent", true), "once armed, unverified deliveries are refused");
assert(!mustRefuse("invalid", false) && !mustRefuse("absent", false), "before any delivery has verified, nothing is refused");
assert(!mustRefuse("valid", true) && !mustRefuse("off", true), "a valid delivery, or the check being off, is never refused");

console.log("smoke-webhook-signature: all assertions passed");

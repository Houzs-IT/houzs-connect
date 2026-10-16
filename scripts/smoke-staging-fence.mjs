// Pure smoke for the staging fence (no DB, no network).
//
// Pins src/lib/staging-fence.ts, which is all that stands between staging's
// LIVE Meta token and a customer or the live WhatsApp account:
//   - staging messages only the allow-listed test phones; production is untouched
//   - staging's call_rest_api reaches only the ERP staging Worker
//   - staging never changes the WhatsApp account; reads still work
//   - production forwards a delivery only when it is ENTIRELY a tester's
//
// Runs under tsx so it imports the real .ts.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { parsePhoneList, recipientRefusal, restUrlRefusal, metaWriteRefusal, relayToStaging } = await import(
  "../src/lib/staging-fence.ts"
);

const TESTER = "60198765432";
const CUSTOMER = "60123456789";
const allowed = parsePhoneList(" +60 19-876 5432 ; 0111 222 3333,,");

assert(allowed.has(TESTER) && allowed.has("601112223333") && allowed.size === 2, "the list reads +60 and local 01x forms");
assert(parsePhoneList(undefined).size === 0 && parsePhoneList("").size === 0, "an unset list is empty");

// Sends
assert(recipientRefusal(TESTER, true, allowed) === null, "staging may message a tester");
assert(recipientRefusal(CUSTOMER, true, allowed) !== null, "staging must not message anyone else");
assert(recipientRefusal(TESTER, true, new Set()) !== null, "an empty list on staging messages nobody");
assert(recipientRefusal("", true, allowed) !== null, "no recipient on staging is refused");
assert(recipientRefusal("MY.3816205081852835", true, new Set(["3816205081852835"])) !== null, "a username can never pass on staging");
assert(recipientRefusal(CUSTOMER, false, new Set()) === null, "production sends are not touched");

// call_rest_api
assert(restUrlRefusal("https://houzs-erp-staging.pages.dev/api/chat-callback", true) === null, "staging may call the ERP staging callback (Pages host)");
assert(restUrlRefusal("https://autocount-sync-api-staging.houzs-erp.workers.dev/api/chat-callback", true) === null, "staging may call the ERP staging Worker");
assert(restUrlRefusal("https://erp.houzscentury.com/api/chat-callback", true) !== null, "staging must not call the production ERP");
assert(restUrlRefusal("https://script.google.com/macros/s/x/exec", true) !== null, "staging must not write to a live Sheet");
assert(restUrlRefusal("https://houzs-erp-staging.pages.dev.evil.example/api", true) !== null, "a look-alike host is refused");
assert(restUrlRefusal("https://erp.houzscentury.com/api/chat-callback", false) === null, "production calls are not touched");

// WhatsApp account
assert(metaWriteRefusal(undefined, true) === null && metaWriteRefusal("GET", true) === null, "staging may read the account");
assert(metaWriteRefusal("POST", true) !== null && metaWriteRefusal("delete", true) !== null, "staging must not change the account");
assert(metaWriteRefusal("POST", false) === null, "production account changes are not touched");

// Relay
const msg = (from) => ({ entry: [{ changes: [{ value: { messages: [{ from, id: "wamid.1", type: "button" }] } }] }] });
const status = (to) => ({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.2", status: "read", recipient_id: to }] } }] }] });
const relay = new Set([TESTER]);
assert(relayToStaging(msg(TESTER), relay), "a tester's tap goes to staging");
assert(relayToStaging(status(TESTER), relay), "a status for a tester goes to staging");
assert(!relayToStaging(msg(CUSTOMER), relay), "a customer's message stays in production");
assert(!relayToStaging(status(CUSTOMER), relay), "a customer's status stays in production");
const mixed = { entry: [{ changes: [{ value: { messages: [{ from: TESTER }, { from: CUSTOMER }] } }] }] };
assert(!relayToStaging(mixed, relay), "a delivery that also carries a customer stays in production whole");
assert(!relayToStaging(msg(TESTER), new Set()), "no relay list, nothing relayed");
assert(!relayToStaging({ entry: [{ changes: [{ value: {} }] }] }, relay), "a delivery with nobody in it is not relayed");
assert(!relayToStaging(null, relay), "an unreadable body is not relayed");

console.log("smoke-staging-fence: OK");

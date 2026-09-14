// Pure smoke for multi-number routing (no DB, no network).
//
// Pins the decisions in src/lib/whatsapp/channel-routing.ts that keep one
// company's WhatsApp customers out of another company's inbox:
//   - a delivery goes to the channel that holds the receiving number
//   - the default sender still reaches the legacy channel until it is assigned
//   - an unassigned second number is REFUSED, never guessed into a company
//   - replies go out from the conversation's own number
//   - once the default number is assigned explicitly, the fallback switches off
//
// Runs under tsx (same hooks as smoke-org-sync.mjs) so it imports the real .ts.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { pickInboundChannel, senderIdForChannel, channelForNumber } = await import(
  "../src/lib/whatsapp/channel-routing.ts"
);

const HOUZS_NUMBER = "1327476460438603";
const HOOKKA_NUMBER = "1219492597923127";

// Production today: one channel, no id, the Houzs number in the secret.
const today = {
  channels: [{ id: "houzs-ch", companyId: "houzs", phoneNumberId: null }],
  legacyChannelId: "houzs-ch",
  defaultSenderId: HOUZS_NUMBER,
};

assert(pickInboundChannel(today, HOUZS_NUMBER)?.id === "houzs-ch", "Houzs number still lands in Houzs before any assignment");
assert(pickInboundChannel(today, HOOKKA_NUMBER) === null, "an unassigned Hookka number is refused, not filed under Houzs");
assert(pickInboundChannel(today, null) === null, "a delivery with no receiving number is refused");
assert(senderIdForChannel(today, "houzs-ch") === HOUZS_NUMBER, "Houzs replies still go out from the Houzs number");
assert(channelForNumber(today, HOUZS_NUMBER)?.legacy === true, "the numbers page shows the Houzs number as assigned via the default");
assert(channelForNumber(today, HOOKKA_NUMBER) === null, "the numbers page shows Hookka as not assigned");

// After Hookka is assigned to its own company.
const withHookka = {
  ...today,
  channels: [...today.channels, { id: "hookka-ch", companyId: "hookka", phoneNumberId: HOOKKA_NUMBER }],
};
assert(pickInboundChannel(withHookka, HOOKKA_NUMBER)?.companyId === "hookka", "a Hookka delivery lands in Hookka");
assert(pickInboundChannel(withHookka, HOUZS_NUMBER)?.companyId === "houzs", "Houzs deliveries are unaffected by the Hookka assignment");
assert(senderIdForChannel(withHookka, "hookka-ch") === HOOKKA_NUMBER, "a Hookka reply goes out from the Hookka number");
assert(senderIdForChannel(withHookka, "houzs-ch") === HOUZS_NUMBER, "a Houzs reply still goes out from the Houzs number");

// After the Houzs number is assigned explicitly to the legacy channel.
const explicit = {
  ...withHookka,
  channels: [
    { id: "houzs-ch", companyId: "houzs", phoneNumberId: HOUZS_NUMBER },
    { id: "hookka-ch", companyId: "hookka", phoneNumberId: HOOKKA_NUMBER },
  ],
};
assert(pickInboundChannel(explicit, HOUZS_NUMBER)?.id === "houzs-ch", "an explicit assignment routes the same way");
assert(channelForNumber(explicit, HOUZS_NUMBER)?.legacy === false, "an explicit assignment is not reported as legacy");

// The default number claimed by a DIFFERENT channel: the legacy fallback must stop.
const claimedElsewhere = {
  channels: [
    { id: "houzs-ch", companyId: "houzs", phoneNumberId: null },
    { id: "other-ch", companyId: "other", phoneNumberId: HOUZS_NUMBER },
  ],
  legacyChannelId: "houzs-ch",
  defaultSenderId: HOUZS_NUMBER,
};
assert(pickInboundChannel(claimedElsewhere, HOUZS_NUMBER)?.id === "other-ch", "an explicit claim beats the legacy fallback");
assert(senderIdForChannel(claimedElsewhere, "houzs-ch") === null, "the legacy channel cannot keep sending from a number assigned elsewhere");

// A channel with no number that is not the legacy one never borrows the default.
const secondCompanyNoNumber = {
  channels: [
    { id: "houzs-ch", companyId: "houzs", phoneNumberId: null },
    { id: "2990-ch", companyId: "2990", phoneNumberId: null },
  ],
  legacyChannelId: "houzs-ch",
  defaultSenderId: HOUZS_NUMBER,
};
assert(senderIdForChannel(secondCompanyNoNumber, "2990-ch") === null, "another company's channel never sends from Houzs's number");
assert(senderIdForChannel(secondCompanyNoNumber, "missing") === null, "an unknown channel has no sender");

console.log("smoke-channel-routing: all assertions passed");

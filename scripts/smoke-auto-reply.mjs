// Pure smoke for automatic replies (no DB, no network, no real clock).
//
// Pins src/lib/auto-reply/decide.ts: opening hours in Malaysia time (including a
// slot past midnight), the away message outside hours and not repeated, the
// welcome inside hours only for a customer writing in fresh, and never both.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { decideAutoReply, isOpen, localClock } = await import("../src/lib/auto-reply/decide.ts");
const { defaultAutoReplies } = await import("../src/lib/auto-reply/defaults.ts");

const TZ = "Asia/Kuala_Lumpur";
// 2026-09-14 is a Monday. Malaysia is UTC+8 all year.
const myt = (iso) => new Date(`${iso}+08:00`);
const H = 3600_000;

assert(localClock(myt("2026-09-14T09:30:00"), TZ).day === "mon", "2026-09-14 is a Monday in Malaysia");
assert(localClock(myt("2026-09-14T09:30:00"), TZ).minutes === 9 * 60 + 30, "minutes past midnight in Malaysia time, not UTC");

const hours = {
  mon: { open: "09:00", close: "18:00" },
  fri: { open: "20:00", close: "02:00" }, // past midnight
  sun: null,
};
assert(isOpen(myt("2026-09-14T09:00:00"), hours, TZ), "open at opening time");
assert(!isOpen(myt("2026-09-14T18:00:00"), hours, TZ), "closed at closing time");
assert(!isOpen(myt("2026-09-14T08:59:00"), hours, TZ), "closed before opening");
assert(!isOpen(myt("2026-09-13T12:00:00"), hours, TZ), "a closed day is closed all day");
assert(isOpen(myt("2026-09-18T23:00:00"), hours, TZ), "Friday late slot is open before midnight");
assert(isOpen(myt("2026-09-19T01:30:00"), hours, TZ), "Friday's slot still open after midnight on Saturday");
assert(!isOpen(myt("2026-09-19T02:30:00"), hours, TZ), "and closed once it ends");

const base = {
  ...defaultAutoReplies("Hookka"),
  welcomeEnabled: true,
  awayEnabled: true,
  hours: { mon: { open: "09:00", close: "18:00" } },
};
const at = (iso, extra = {}) => ({
  settings: base,
  now: myt(iso),
  previousInboundAt: null,
  lastWelcomeAt: null,
  lastAwayAt: null,
  ...extra,
});

assert(decideAutoReply(at("2026-09-14T10:00:00")) === "welcome", "a first message during hours is welcomed");
assert(decideAutoReply(at("2026-09-14T22:00:00")) === "away", "a first message after hours gets the away message");
assert(
  decideAutoReply(at("2026-09-14T22:05:00", { lastAwayAt: myt("2026-09-14T22:00:00") })) === null,
  "the away message is not repeated five minutes later — and no welcome follows it"
);
assert(
  decideAutoReply(at("2026-09-15T12:00:00", { lastAwayAt: myt("2026-09-14T22:00:00") })) === "away",
  "outside hours again after the repeat window, the away message is sent again"
);
assert(
  decideAutoReply(at("2026-09-14T10:05:00", { previousInboundAt: myt("2026-09-14T10:00:00"), lastWelcomeAt: myt("2026-09-14T10:00:00") })) === null,
  "a customer mid-conversation is not greeted again"
);
assert(
  decideAutoReply(at("2026-09-14T10:00:00", { previousInboundAt: new Date(myt("2026-09-14T10:00:00").getTime() - 30 * H) })) === "welcome",
  "a customer back after more than a day of silence is greeted again"
);
assert(
  decideAutoReply({ ...at("2026-09-14T22:00:00"), settings: { ...base, awayEnabled: false } }) === "welcome",
  "with the away message off, a message after hours may still be welcomed"
);
assert(
  decideAutoReply({ ...at("2026-09-14T10:00:00"), settings: { ...base, welcomeText: "   " } }) === null,
  "an empty message is never sent"
);
assert(defaultAutoReplies("X").welcomeEnabled === false && defaultAutoReplies("X").awayEnabled === false, "drafts start switched off");

console.log("smoke-auto-reply: all assertions passed");

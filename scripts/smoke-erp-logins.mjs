// Pure smoke for lib/erp-logins.ts: how a Hookka or Conts answer is read, and
// which ERP is asked first. No DB, no network.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { readAnswer, erpOrder, configuredErps } = await import("../src/lib/erp-logins.ts");

// Success, and the email is lower-cased.
let a = readAnswer(200, { ok: true, user: { email: "Ali@Hookka.com", name: "Ali", role: "admin" } });
assert(a.kind === "ok" && a.email === "ali@hookka.com" && a.name === "Ali", "ok answer");
a = readAnswer(200, { ok: true, user: { email: "x@y.com", name: "" } });
assert(a.kind === "ok" && a.name === "x@y.com", "a blank name falls back to the email");
assert(readAnswer(200, { ok: true, user: {} }).kind === "unreachable", "ok without an email is not a sign-in");
assert(readAnswer(200, { ok: true }).kind === "unreachable", "ok without a user is not a sign-in");

// Two-step.
a = readAnswer(200, { twoStep: true, challenge: "abc" });
assert(a.kind === "twoStep" && a.challenge === "abc", "two-step answer");
assert(readAnswer(200, { twoStep: true }).kind === "unreachable", "two-step without a challenge is not usable");

// Wrong password or code, in both ERPs' error shapes: try the next ERP.
a = readAnswer(401, { error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } });
assert(a.kind === "wrong" && a.message === "Wrong email or password.", "Conts shape");
a = readAnswer(401, { success: false, error: "Wrong email or password." });
assert(a.kind === "wrong" && a.message === "Wrong email or password.", "Hookka shape");

// Connect's own key refused is our fault, never "wrong password".
assert(readAnswer(401, { error: { code: "UNAUTHENTICATED", message: "Not allowed." } }).kind === "unreachable", "bad key (Conts)");
assert(readAnswer(401, { success: false, error: "Not allowed." }).kind === "unreachable", "bad key (Hookka)");

// Locked, disabled, throttled: stop, and say why.
a = readAnswer(423, { error: { message: "Locked for 15 minutes." } });
assert(a.kind === "stopped" && a.message === "Locked for 15 minutes.", "locked stops");
assert(readAnswer(403, { success: false, error: "Account disabled" }).kind === "stopped", "disabled stops");
assert(readAnswer(429, null).kind === "stopped", "throttled stops");

// Anything else is "could not ask".
for (const s of [500, 502, 503, 404]) assert(readAnswer(s, null).kind === "unreachable", `${s} is unreachable`);

// Order: the address's own ERP first; only configured ones.
assert(erpOrder("conts", ["hookka", "conts"]).join() === "conts,hookka", "Conts address asks Conts first");
assert(erpOrder("houzs", ["hookka", "conts"]).join() === "hookka,conts", "Houzs address keeps the usual order");
assert(erpOrder("hookka", ["conts"]).join() === "conts", "an ERP not set up is never asked");

// Configured: both a URL and a key.
assert(
  configuredErps({ HOOKKA_LOGIN_URL: "https://h", HOOKKA_LOGIN_KEY: "k", CONTS_LOGIN_URL: "https://c" }).join() === "hookka",
  "a URL without a key is not configured"
);
assert(configuredErps({}).length === 0, "nothing set, nothing asked");

console.log("smoke-erp-logins: ok");

// Pure smoke for the business-profile validation (no DB, no network).
//
// Meta refuses a bad profile with a generic parameter error that does not name
// the field; profileProblem() is what names it, in both the form and the server
// action. This pins the limits it enforces, and pins that a save sends only the
// fields that changed (profileChanges) — sending every field let one empty box
// sink the whole save.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { profileChanges, profileProblem, PHOTO_MAX_BYTES, PHOTO_TYPES, PROFILE_LIMITS, VERTICALS } = await import(
  "../src/lib/whatsapp/profile-limits.ts"
);

const good = {
  about: "Furniture & home living",
  address: "Lot 1831, Jalan KPB 1, Balakong, 43300 Seri Kembangan, Selangor",
  description: "Sofas, beds and mattresses, delivered and installed.",
  email: "hello@houzscentury.com",
  websites: ["https://houzscentury.com"],
  vertical: "RETAIL",
};

// ── limits ──────────────────────────────────────────────────────────────────
assert(profileProblem(good) === null, "a normal profile passes");
assert(profileProblem({ ...good, email: "", websites: [], vertical: "" }) === null, "email, websites and category are optional");
assert(profileProblem({ ...good, about: "x".repeat(PROFILE_LIMITS.about + 1) })?.includes("about"), "an over-long about line is named");
assert(profileProblem({ ...good, about: "" })?.includes("about"), "an empty about line is refused — Meta does not accept one");
assert(profileProblem({ ...good, description: "x".repeat(PROFILE_LIMITS.description + 1) })?.includes("description"), "an over-long description is named");
assert(profileProblem({ ...good, address: "x".repeat(PROFILE_LIMITS.address + 1) })?.includes("address"), "an over-long address is named");
assert(profileProblem({ ...good, email: "not-an-email" })?.includes("email"), "a malformed email is refused");
assert(profileProblem({ ...good, websites: ["houzscentury.com"] })?.includes("https://"), "a website without its scheme is refused");
assert(profileProblem({ ...good, websites: ["https://a.com", "https://b.com", "https://c.com"] }) !== null, "more than two websites is refused");
assert(profileProblem({ ...good, vertical: "FURNITURE" }) !== null, "a category Meta does not have is refused");
assert(!VERTICALS.some((v) => v.value === "UNDEFINED" || v.value === "NOT_A_BIZ"), "unsettable categories are not offered");
assert(profileProblem({}) === null, "an update with no fields has nothing wrong with it");
assert(profileProblem({ address: "Balakong" }) === null, "a partial update is checked on its own fields only");
assert(PHOTO_TYPES.includes("image/jpeg") && PHOTO_TYPES.includes("image/png") && PHOTO_MAX_BYTES === 5 * 1024 * 1024, "photo rules are JPEG/PNG up to 5 MB");

// ── only what changed is sent ───────────────────────────────────────────────
// The Houzs Century number as Meta returned it on 2026-09-14: a description and
// a category, everything else empty.
const houzs = {
  about: "",
  address: "",
  description: "Houzs Century is a Malaysian furniture retailer. We use this line for delivery scheduling, order updates and customer support.",
  email: "",
  websites: [],
  vertical: "RETAIL",
};
// What the form sends: every box, including the two website boxes.
const form = (patch = {}) => ({ ...houzs, websites: ["", ""], ...patch });
const keys = (o) => Object.keys(o).sort().join(",");

assert(keys(profileChanges(houzs, form())) === "", "an untouched form sends nothing — not the empty about line, not the empty email");

const addressOnly = profileChanges(houzs, form({ address: "  Balakong, Selangor " }));
assert(keys(addressOnly) === "address" && addressOnly.address === "Balakong, Selangor", "typing only an address sends only the address, trimmed");
assert(profileProblem(addressOnly) === null, "…and that save is not refused for the about line left empty");

const aboutAndSite = profileChanges(houzs, form({ about: "Furniture & home living", websites: ["", " https://houzscentury.com "] }));
assert(keys(aboutAndSite) === "about,websites", "about and a website typed into the second box are both sent");
assert(aboutAndSite.websites.length === 1 && aboutAndSite.websites[0] === "https://houzscentury.com", "empty website boxes are dropped and the rest trimmed");

const cleared = profileChanges({ ...houzs, about: "Furniture" }, form({ about: "   " }));
assert(keys(cleared) === "about" && cleared.about === "", "clearing an about line that was set is a change…");
assert(profileProblem(cleared)?.includes("about"), "…that is refused with a reason instead of reaching Meta");

const emailCleared = profileChanges({ ...houzs, email: "hello@houzscentury.com" }, form({ email: "" }));
assert(keys(emailCleared) === "email" && emailCleared.email === "" && profileProblem(emailCleared) === null, "clearing an email that was set is sent as a change");

assert(keys(profileChanges(houzs, form({ vertical: "" }))) === "", "a category cannot be taken back to not set, so it is never sent empty");
assert(keys(profileChanges(houzs, form({ vertical: "HOTEL" }))) === "vertical", "picking another category sends it");
assert(keys(profileChanges(houzs, { ...houzs, websites: "not-a-list", about: 42 })) === "", "junk from a hand-made request is treated as empty, not thrown on");

// ── System Logs says where a save stopped ───────────────────────────────────
const { summarise } = await import("../src/app/(app)/logs/humanise.ts");
const row = (eventType, payload) => summarise("numbers", eventType, eventType.endsWith(":ok"), payload);
const stoppedHere = row("numbers:profile:failed", { action: "profile", number: "1327476460438603", stage: "connect", fields: ["about"], error: "The about line cannot be left empty on WhatsApp — write one short line." });
assert(stoppedHere.outcome.includes("Not sent to Meta") && stoppedHere.tone === "bad", "a save stopped by Connect is not reported as Meta refusing it");
assert(stoppedHere.details.some((d) => d.startsWith("Reason:")) && stoppedHere.details.includes("fields: about"), "…and names the reason and the fields");
const nothing = row("numbers:profile:ok", { action: "profile", stage: "connect", fields: [] });
assert(nothing.outcome.includes("no field had changed") && nothing.tone === "ok", "a save with nothing changed says so");
const refused = row("numbers:profile:failed", { action: "profile", stage: "meta", fields: ["email"], error: "(#100) Invalid parameter" });
assert(refused.outcome.includes("Meta refused") && refused.details.includes("Meta said: (#100) Invalid parameter"), "a refusal from Meta is still reported as Meta's");
const unread = row("numbers:profile-load:failed", { action: "profile-load", stage: "read", error: "Meta did not respond in time." });
assert(unread.outcome.includes("did not return the current profile"), "a profile Meta would not return is reported as such");
const legacy = row("numbers:register:ok", { action: "register", statusAfter: "CONNECTED" });
assert(legacy.outcome === "Meta accepted it." && legacy.details.includes("Meta now reports CONNECTED"), "rows without a stage read as before");

console.log("smoke-business-profile: all assertions passed");

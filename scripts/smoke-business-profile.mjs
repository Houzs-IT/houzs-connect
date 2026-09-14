// Pure smoke for the business-profile validation (no DB, no network).
//
// Meta refuses a bad profile with a generic parameter error that does not name
// the field; profileProblem() is what names it, in both the form and the server
// action. This pins the limits it enforces.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { profileProblem, PROFILE_LIMITS, VERTICALS } = await import("../src/lib/whatsapp/profile-limits.ts");

const good = {
  about: "Furniture & home living",
  address: "Lot 1831, Jalan KPB 1, Balakong, 43300 Seri Kembangan, Selangor",
  description: "Sofas, beds and mattresses, delivered and installed.",
  email: "hello@houzscentury.com",
  websites: ["https://houzscentury.com"],
  vertical: "RETAIL",
};

assert(profileProblem(good) === null, "a normal profile passes");
assert(profileProblem({ ...good, email: "", websites: [], vertical: "" }) === null, "email, websites and category are optional");
assert(profileProblem({ ...good, about: "x".repeat(PROFILE_LIMITS.about + 1) })?.includes("about"), "an over-long about line is named");
assert(profileProblem({ ...good, description: "x".repeat(PROFILE_LIMITS.description + 1) })?.includes("description"), "an over-long description is named");
assert(profileProblem({ ...good, address: "x".repeat(PROFILE_LIMITS.address + 1) })?.includes("address"), "an over-long address is named");
assert(profileProblem({ ...good, email: "not-an-email" })?.includes("email"), "a malformed email is refused");
assert(profileProblem({ ...good, websites: ["houzscentury.com"] })?.includes("https://"), "a website without its scheme is refused");
assert(profileProblem({ ...good, websites: ["https://a.com", "https://b.com", "https://c.com"] }) !== null, "more than two websites is refused");
assert(profileProblem({ ...good, vertical: "FURNITURE" }) !== null, "a category Meta does not have is refused");
assert(!VERTICALS.some((v) => v.value === "UNDEFINED" || v.value === "NOT_A_BIZ"), "unsettable categories are not offered");

console.log("smoke-business-profile: all assertions passed");

// Pure smoke for lib/company-brand.ts: the logo each address and person sees, and
// the company a sign-in lands in. No DB, no network.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { brandForHost, brandForCompany, brandKeyForCompany, pickLoginRow, themeCss, companyOrigin } = await import("../src/lib/company-brand.ts");

// Web address -> brand.
assert(brandForHost("chat.houzscentury.com").key === "houzs", "Houzs address");
assert(brandForHost("chat.hookka.com").key === "hookka", "Hookka address");
assert(brandForHost("CHAT.TheConts.com").key === "conts", "address case is ignored");
assert(brandForHost("chat.2990shome.com").key === "2990", "2990 address");
assert(brandForHost("chat.hookka.com:443").key === "hookka", "a port is ignored");
assert(brandForHost("localhost:3000").key === "houzs", "any other address is Houzs");
assert(brandForHost("hookka.localhost:3005").key === "hookka", "hookka.localhost stands in for the Hookka address");
assert(brandForHost("conts.localhost").key === "conts", "conts.localhost stands in for the Conts address");
assert(brandForHost("evil.hookka.localhost").key === "houzs", "only the exact local names count");
assert(brandForHost(null).key === "houzs", "no address is Houzs");

// Company name -> brand.
assert(brandKeyForCompany("Houzs Century") === "houzs", "Houzs Century");
assert(brandKeyForCompany("2990's Home") === "2990", "2990's Home");
assert(brandKeyForCompany("Some New Co") === null, "an unknown company has no brand");

// The company being worked in -> logo and colours.
assert(brandForCompany("Hookka").key === "hookka", "Hookka shows its own logo");
assert(brandForCompany("The Conts").key === "conts", "The Conts shows its own logo");
assert(brandForCompany("Houzs Century Sdn Bhd").key === "houzs", "Houzs");
assert(brandForCompany("Some New Co").key === "houzs", "an unknown company shows Houzs");
assert(brandForCompany(null).key === "houzs", "no company shows Houzs");
assert(themeCss("houzs") === "", "Houzs keeps the colours in globals.css");
assert(themeCss("2990").includes("--color-accent:#a6471e"), "2990 lays its rust colours over :root");
assert(themeCss("hookka").startsWith(":root{") && themeCss("hookka").includes("--color-accent:"), "Hookka lays its colours over :root");
assert(themeCss("conts").includes("--color-rail:"), "The Conts colours the rail too");

// Sign-in landing.
const houzs = { id: "h", companyName: "Houzs Century" };
const hookka = { id: "k", companyName: "Hookka" };
assert(pickLoginRow([houzs, hookka], "chat.hookka.com") === hookka, "lands in the address's company");
assert(pickLoginRow([houzs, hookka], "chat.houzscentury.com") === houzs, "lands in the address's company");
assert(pickLoginRow([hookka], "chat.houzscentury.com") === hookka, "any address works, but only for a company they hold");
assert(pickLoginRow([houzs, hookka], "chat.theconts.com") === houzs, "falls back to their first company");
assert(pickLoginRow([], "chat.hookka.com") === null, "no company means no way in");

// Switching company moves to its address.
assert(companyOrigin("hookka", "localhost:3005", false) === "http://hookka.localhost:3005", "on a computer, the .localhost stand-in");
assert(companyOrigin("houzs", "conts.localhost:3005", false) === "http://localhost:3005", "Houzs is plain localhost");
assert(companyOrigin("conts", "conts.localhost:3005", false) === null, "already there: stay");
assert(companyOrigin("hookka", "chat.houzscentury.com", false) === null, "production stays until the domains are live");
assert(companyOrigin("hookka", "chat.houzscentury.com", true) === "https://chat.hookka.com", "then goes to the company's own domain");
assert(companyOrigin("houzs", "chat.houzscentury.com", true) === null, "already on Houzs's own address");
assert(companyOrigin("hookka", "houzs-connect-staging.x.workers.dev", true) === null, "staging has one address: stay");

console.log("smoke-company-brand: ok");

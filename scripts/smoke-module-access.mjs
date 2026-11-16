// Pure smoke for lib/module-access.ts: what each role starts with, how the
// Access page's ticks change it, and where someone without a module lands.
// No DB, no network.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { MODULES, resolveModules, homeFor } = await import("../src/lib/module-access.ts");

// Starting points.
// Everyone starts with every module; Roles, Team, Access and the switcher are held back by role elsewhere.
for (const r of ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER", null]) {
  assert(resolveModules(r, []).length === MODULES.length, `${r} starts with every module`);
}

// Ticks over the role.
let m = resolveModules("AGENT", [{ module: "payments", allowed: false }, { module: "payments", allowed: true }]);
assert(m.includes("payments") && m.includes("inbox"), "a tick gives a module back");
m = resolveModules("AGENT", [{ module: "contacts", allowed: false }]);
assert(!m.includes("contacts") && m.includes("inbox"), "an untick takes one away");
m = resolveModules("ADMIN", [{ module: "settings", allowed: false }, { module: "logs", allowed: false }]);
assert(!m.includes("settings") && !m.includes("logs") && m.includes("dashboard"), "an admin can be limited");
assert(resolveModules("SUPER_ADMIN", [{ module: "settings", allowed: false }]).length === MODULES.length, "a Super Admin always keeps everything");
assert(resolveModules("AGENT", [{ module: "nonsense", allowed: false }]).length === MODULES.length, "an unknown module is ignored");
assert(resolveModules("AGENT", [])[0] === "dashboard", "kept in menu order");

// Landing.
assert(homeFor(["dashboard", "inbox"]) === "/dashboard", "first module they have");
assert(homeFor(["contacts"]) === "/contacts", "even when Service is off");
assert(homeFor(["settings"]) === "/settings", "settings alone");
assert(homeFor([]) === "/settings/profile", "nothing at all: their own settings");

console.log("smoke-module-access: ok");

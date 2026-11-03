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

const { MODULES, roleModules, resolveModules, homeFor } = await import("../src/lib/module-access.ts");

// Starting points.
for (const r of ["SUPER_ADMIN", "OWNER", "ADMIN"]) assert(roleModules(r).length === MODULES.length, `${r} starts with every module`);
for (const r of ["MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"]) {
  assert(roleModules(r).join() === "inbox,internal,contacts", `${r} starts with the chats and contacts`);
}
assert(roleModules(null).join() === "inbox,internal,contacts", "no role is staff");

// Ticks over the role.
let m = resolveModules("AGENT", [{ module: "payments", allowed: true }]);
assert(m.includes("payments") && m.includes("inbox"), "a tick adds a module to staff");
m = resolveModules("AGENT", [{ module: "contacts", allowed: false }]);
assert(!m.includes("contacts") && m.includes("inbox"), "an untick takes one away");
m = resolveModules("ADMIN", [{ module: "settings", allowed: false }, { module: "logs", allowed: false }]);
assert(!m.includes("settings") && !m.includes("logs") && m.includes("dashboard"), "an admin can be limited");
assert(resolveModules("SUPER_ADMIN", [{ module: "settings", allowed: false }]).length === MODULES.length, "a Super Admin always keeps everything");
assert(resolveModules("AGENT", [{ module: "nonsense", allowed: true }]).join() === "inbox,internal,contacts", "an unknown module is ignored");
assert(resolveModules("AGENT", [{ module: "dashboard", allowed: true }])[0] === "dashboard", "kept in menu order");

// Landing.
assert(homeFor(["dashboard", "inbox"]) === "/dashboard", "first module they have");
assert(homeFor(["contacts"]) === "/contacts", "even when Service is off");
assert(homeFor(["settings"]) === "/settings", "settings alone");
assert(homeFor([]) === "/settings/profile", "nothing at all: their own settings");

console.log("smoke-module-access: ok");

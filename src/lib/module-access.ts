// Which modules a person may open (CONNECT-0003). Pure, pinned by
// scripts/smoke-module-access.mjs; lib/full-access.ts reads the saved choices.
//
// The role gives the starting point: owners and admins every module, everyone
// else the chats and contacts. A Super Admin can tick or untick any module for
// any person on Settings → Access, per company. Super Admins themselves always
// have everything, so the people who set access can never lock themselves out.

import { isAdminRole } from "@/lib/permissions";

export const MODULES = [
  "dashboard",
  "inbox",
  "internal",
  "contacts",
  "automations",
  "campaigns",
  "broadcast",
  "drip",
  "payments",
  "logs",
  "settings",
] as const;
export type Module = (typeof MODULES)[number];

/** What staff (not admins) start with. */
export const STAFF_MODULES: Module[] = ["inbox", "internal", "contacts"];

export const isModule = (v: unknown): v is Module => typeof v === "string" && (MODULES as readonly string[]).includes(v);

/** The role's starting point, before any choice made on the Access page. */
export function roleModules(role: string | null | undefined): Module[] {
  return isAdminRole(role) ? [...MODULES] : [...STAFF_MODULES];
}

/** The role's starting point with this person's saved ticks laid over it, in MODULES order. */
export function resolveModules(role: string | null | undefined, choices: { module: string; allowed: boolean }[]): Module[] {
  if (role === "SUPER_ADMIN") return [...MODULES];
  const on = new Set<Module>(roleModules(role));
  for (const c of choices) {
    if (!isModule(c.module)) continue;
    if (c.allowed) on.add(c.module);
    else on.delete(c.module);
  }
  return MODULES.filter((m) => on.has(m));
}

/** Where to send someone who opened a module they may not: the first one they have, else their own settings. */
export const MODULE_HREF: Record<Module, string> = {
  dashboard: "/dashboard",
  inbox: "/inbox",
  internal: "/internal",
  contacts: "/contacts",
  automations: "/automations",
  campaigns: "/campaigns",
  broadcast: "/broadcast",
  drip: "/drip-campaigns",
  payments: "/payments",
  logs: "/logs",
  settings: "/settings",
};
export function homeFor(modules: Module[]): string {
  return modules[0] ? MODULE_HREF[modules[0]] : "/settings/profile";
}

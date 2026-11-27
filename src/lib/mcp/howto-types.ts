// ---------------------------------------------------------------------------
// AI Connector round 5: process help ("how do I ...", owner 2026-11-27).
// Types, the page gates and the link helper shared by the help tools
// (lib/mcp/howto.ts). Pure: no reads, no writes.
//
// RBAC: a guide's canDo is the SAME check Connect makes, never a connector-only
// rule (owner: the connector mirrors the app's RBAC exactly).
//   - module: lib/module-access.ts resolveModules (role start + Settings →
//     Access ticks). Module layouts call lib/full-access.ts requireModule; the
//     rail hides a module the person lacks (components/shell/nav.ts navFor).
//   - admin: lib/full-access.ts requireAdmin = the settings module AND an
//     admin role (lib/permissions.ts isAdminRole: SUPER_ADMIN / OWNER / ADMIN).
//   - superAdmin: the server action itself checks role === "SUPER_ADMIN"
//     (settings/access/actions.ts editor, team/actions.ts setRoleForm/toggleAccess).
//   - cap: the company's role matrix (lib/permissions.ts can(); defaults
//     DEFAULTS, editable on Settings → Roles & permissions).
//   - supervisor: lib/mcp/round3.ts moodScanAllowed (chat content, owner 2026-11-26).
//   - mcpAdmin: lib/mcp/core.ts isMcpAdminRole (SUPER_ADMIN / OWNER).
// The honesty smoke (scripts/smoke-mcp-howto.mjs) fails when a page gate here
// drifts from the requireModule / requireAdmin calls in src/app.
// ---------------------------------------------------------------------------
import { CAPABILITIES, DEFAULTS, isAdminRole, MATRIX_ROLES, type Capability, type MatrixRole } from "@/lib/permissions";
import type { Module } from "@/lib/module-access";
import { isMcpAdminRole } from "./core";
import { moodScanAllowed } from "./round3";

/** The person asking: their Connect role, their modules and their company's role-matrix capabilities. */
export type Viewer = { role: string; modules: readonly Module[]; caps: ReadonlySet<Capability>; company: string };

/** Who a guide is written for. */
export type HowtoAudience = "agent" | "supervisor" | "admin" | "everyone";

/** The Connect check behind a page or an action. Every key present must pass. */
export type HowtoGate = { module?: Module; admin?: true; superAdmin?: true; cap?: Capability; supervisor?: true; mcpAdmin?: true };

/** One field on the form: `label` is the exact UI label (checked against src/). */
export type HowtoField = { label: string; required: boolean; format: string; validation: string; example: string };

/**
 * One click. Text quotes UI labels in double quotes ("Resolve"); every quoted string must exist in
 * src/. `highlight` is the label of the element to press on `page`. `role` is set on flow steps.
 */
export type HowtoStep = { text: string; page: string | null; highlight: string | null; role?: string };

/** A full SOP: one task ("task") or a whole chain written click by click ("flow"). */
export type HowtoGuide = {
  id: string;
  kind: "task" | "flow";
  audience: HowtoAudience;
  title: string;
  module: string;
  keywords: string[];
  purpose: string;
  prerequisites: string[];
  who: string;
  permission: string;
  /** Extra checks the write needs beyond opening the page (cited in the guide file). */
  needs?: HowtoGate;
  /** Chat content: only shown to supervisors and admins (round3.moodScanAllowed). */
  supervisorOnly?: true;
  /** Explained only: the connector never does this (campaigns / broadcasts). */
  explainOnly?: true;
  page: string;
  sidebar: string;
  fields: HowtoField[];
  steps: HowtoStep[];
  checkBefore: string[];
  result: string[];
  warnings: string[];
  undo: string;
  approvals: string[];
  deadlines: string[];
  commonMistakes: { mistake: string; fix: string }[];
  workedExample: string;
  related: string[];
  nextStep: string | null;
  contact: string;
  /**
   * What differs between the companies on Connect (Houzs Century, 2990's Home, The Conts, Hookka).
   * Connect has no company-specific code path for these tasks: the differences are each company's own
   * data (its WhatsApp numbers, approved templates, departments, role matrix, Access ticks, auto replies).
   */
  perCompany: string | null;
};

/** One Connect area, for module_overview. `sidebar` is the exact menu label. */
export type ModuleOverview = {
  id: string;
  name: string;
  sidebar: string;
  keywords: string[];
  purpose: string;
  keyPages: { path: string; label: string; what: string }[];
  users: string;
  connects: string[];
};

/** A term people meet in Connect, for glossary. */
export type GlossaryTerm = { term: string; aliases: string[]; keywords: string[]; definition: string; seeAlso: string[]; page: string | null };

/** A first-week path for one role, for onboarding. `guides` are guide ids. */
export type OnboardingPath = {
  role: string;
  title: string;
  keywords: string[];
  days: { day: string; goals: string[]; guides: string[]; pages: string[] }[];
  contact: string;
};

/** A real Connect error message. Each `match` is a substring of the app's own text (checked). */
export type ErrorEntry = { id: string; match: string[]; module: string; meaning: string; cause: string; fix: string; source: string };

// ── page gates ──────────────────────────────────────────────────────────────

/**
 * Every page a guide may send someone to, and the check Connect makes for it. Module pages:
 * the module's layout requireModule (and the rail's navFor). /inbox and /contacts have no
 * layout guard yet (see tasks/HANDOFF.md, round 5 findings) but the rail shows them only with
 * the module, so the guide follows the module. Personal settings pages (profile, security,
 * notifications, AI Connector) need nothing beyond signing in.
 */
export const PAGE_GATES: Record<string, HowtoGate> = {
  "/dashboard": { module: "dashboard" },
  "/inbox": { module: "inbox" },
  "/inbox/:id": { module: "inbox" },
  "/internal": { module: "internal" },
  "/contacts": { module: "contacts" },
  "/automations": { module: "automations" },
  "/campaigns": { module: "campaigns" },
  "/campaigns/new": { module: "campaigns" },
  "/campaigns/:id": { module: "campaigns" },
  "/broadcast": { module: "broadcast" },
  "/drip-campaigns": { module: "drip" },
  "/payments": { module: "payments" },
  "/logs": { module: "logs" },
  "/settings": { module: "settings" },
  "/settings/profile": {},
  "/settings/security": {},
  "/settings/notifications": {},
  "/settings/ai-connector": {},
  "/settings/roles": { admin: true },
  "/settings/team": { admin: true },
  "/settings/access": { admin: true },
  "/settings/departments": { module: "settings" },
  "/settings/auto-replies": { module: "settings" },
  // No layout guard; the Settings menu lists it only with the settings module (SettingsMenu.tsx).
  "/settings/auto-assign": { module: "settings" },
  "/settings/library": { module: "settings" },
  "/settings/templates": { module: "settings" },
  "/settings/templates/new": { module: "settings" },
  "/settings/templates/:id": { module: "settings" },
  "/it-support": {},
};

const routeMatches = (route: string, path: string): boolean => {
  const r = route.split("/");
  const p = path.split("/");
  return r.length === p.length && r.every((s, i) => s.startsWith(":") || s === p[i]);
};

/** The route key of a page (query and hash dropped), or null when it is not a known page. */
export function routeOf(page: string): string | null {
  const path = page.split("?")[0].split("#")[0];
  if (Object.prototype.hasOwnProperty.call(PAGE_GATES, path)) return path;
  return Object.keys(PAGE_GATES).find((r) => routeMatches(r, path)) ?? null;
}

/** The gate of a page. Unknown page = closed. */
export function gateForPage(page: string): HowtoGate {
  const r = routeOf(page);
  return r ? PAGE_GATES[r] : { superAdmin: true, mcpAdmin: true, module: "settings", cap: "manageSys" };
}

/** Does this person pass the gate? Mirrors requireModule / requireAdmin / can() / moodScanAllowed. */
export function gatePasses(gate: HowtoGate, v: Viewer): boolean {
  if (gate.module && !v.modules.includes(gate.module)) return false;
  if (gate.admin && !(v.modules.includes("settings") && isAdminRole(v.role))) return false;
  if (gate.superAdmin && v.role !== "SUPER_ADMIN") return false;
  if (gate.cap && !v.caps.has(gate.cap)) return false;
  if (gate.supervisor && !moodScanAllowed(v.role)) return false;
  if (gate.mcpAdmin && !isMcpAdminRole(v.role)) return false;
  return true;
}

/** May this person open the page? */
export const canOpenPage = (page: string, v: Viewer): boolean => gatePasses(gateForPage(page), v);

/** May this person do the guide: open its page and pass the extra checks its write needs. */
export function canDoGuide(g: Pick<HowtoGuide, "page" | "needs">, v: Viewer): boolean {
  return canOpenPage(g.page, v) && (!g.needs || gatePasses(g.needs, v));
}

/** Is this guide shown to the person at all? Chat-content guides only to supervisors and admins. */
export const guideVisible = (g: Pick<HowtoGuide, "supervisorOnly">, v: Viewer): boolean => !g.supervisorOnly || moodScanAllowed(v.role);

export const NO_PERMISSION_NOTE = "You don't have access to this in Houzs Connect — ask your admin (a Super Admin can change module access on Settings → Access).";

/** The note for a guide / page this person cannot use, naming the check that failed. */
export function blockedNote(g: Pick<HowtoGuide, "page" | "needs">, v: Viewer): string {
  const gates = [gateForPage(g.page), g.needs ?? {}];
  for (const gate of gates) {
    if (gate.module && !v.modules.includes(gate.module)) return `${NO_PERMISSION_NOTE} Missing module: ${gate.module}.`;
    if (gate.admin && !isAdminRole(v.role)) return "Only an owner, admin or Super Admin can open this page in Houzs Connect.";
    if (gate.superAdmin && v.role !== "SUPER_ADMIN") return "Only a Super Admin can do this in Houzs Connect.";
    if (gate.cap && !v.caps.has(gate.cap)) return `Your role does not have "${gate.cap}" in your company's Roles & permissions — ask a Super Admin.`;
    if (gate.mcpAdmin && !isMcpAdminRole(v.role)) return "Only the connector admin (a Super Admin or Owner) can do this.";
  }
  return NO_PERMISSION_NOTE;
}

/** The capabilities this role has in its company: DEFAULTS with the company's saved choices laid over (lib/permissions.ts companyMatrix). */
export function capsFor(role: string, saved: { capability: string; allowed: boolean }[]): Set<Capability> {
  if (role === "SUPER_ADMIN") return new Set(CAPABILITIES);
  const col = (role === "OWNER" ? "ADMIN" : role) as MatrixRole;
  if (!(MATRIX_ROLES as readonly string[]).includes(col)) return new Set();
  const on = new Set<Capability>(CAPABILITIES.filter((c) => DEFAULTS[c].includes(col)));
  for (const r of saved) {
    if (!(CAPABILITIES as readonly string[]).includes(r.capability)) continue;
    if (r.allowed) on.add(r.capability as Capability);
    else on.delete(r.capability as Capability);
  }
  return on;
}

/** A Connect link with ?highlight=<label> merged into the page's own query. Null for a :param page. */
export function connectLink(origin: string, page: string, highlight: string | null): string | null {
  if (page.includes(":")) return null;
  if (!highlight) return `${origin}${page}`;
  const sep = page.includes("?") ? "&" : "?";
  return `${origin}${page}${sep}highlight=${encodeURIComponent(highlight)}`;
}

// Round 5 honesty + logic smoke for the AI Connector's process help
// (src/lib/mcp/howto*.ts). Owner 2026-11-27: the help data may only name pages
// that exist in src/app, labels that exist in src/, errors that are the app's
// own text, and page gates that equal the app's requireModule / requireAdmin.
// No DB, no network.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";
import { appGuards, labelInSource, quotedLabels, routeExists, corpus } from "./lib/frontend-honesty.mjs";

registerCjs();
registerEsm();

let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const none = (bad, msg) => assert(bad.length === 0, `${msg}\n  ${bad.join("\n  ")}`);

const { HOWTO_GUIDES } = await import("../src/lib/mcp/howto-guides.ts");
const ref = await import("../src/lib/mcp/howto-ref.ts");
const T = await import("../src/lib/mcp/howto-types.ts");
const H = await import("../src/lib/mcp/howto.ts");
const { MODULES: ALL_MODULES } = await import("../src/lib/module-access.ts");

const ids = new Set(HOWTO_GUIDES.map((g) => g.id));
const CJK = /[㐀-鿿]/;

// ── guides: full SOP, honest pages and labels ──
assert(ids.size === HOWTO_GUIDES.length, "guide ids are unique");
for (const g of HOWTO_GUIDES) {
  for (const k of ["purpose", "who", "permission", "contact", "workedExample", "undo", "sidebar", "title", "module"]) assert(g[k] && g[k].length > 0, `${g.id}: ${k} is filled`);
  for (const k of ["steps", "keywords", "result", "commonMistakes"]) assert(g[k].length > 0, `${g.id}: ${k} has entries`);
  for (const k of ["prerequisites", "fields", "checkBefore", "warnings", "approvals", "deadlines", "related"]) assert(Array.isArray(g[k]), `${g.id}: ${k} is a list`);
}

const labelsOf = (g) => {
  const out = [];
  for (const s of g.steps) {
    out.push(...quotedLabels(s.text));
    if (s.highlight) out.push(s.highlight);
  }
  for (const f of g.fields) out.push(f.label);
  return out;
};

{
  const bad = [];
  for (const g of HOWTO_GUIDES) {
    if (!routeExists(g.page)) bad.push(`${g.id}: ${g.page}`);
    if (!T.routeOf(g.page)) bad.push(`${g.id}: ${g.page} has no gate`);
    for (const s of g.steps) {
      if (s.page && !routeExists(s.page)) bad.push(`${g.id} step: ${s.page}`);
      if (s.page && !T.routeOf(s.page)) bad.push(`${g.id} step: ${s.page} has no gate`);
    }
  }
  none(bad, "every guide page exists in src/app and has a gate");
}
{
  const bad = [];
  for (const g of HOWTO_GUIDES) for (const l of labelsOf(g)) if (!labelInSource(l)) bad.push(`${g.id}: "${l}"`);
  none(bad, "every quoted UI label, highlight and field label exists in src/");
}
for (const g of HOWTO_GUIDES.filter((x) => x.kind === "flow")) {
  assert(g.steps.every((s) => s.role), `${g.id}: every flow step names who does it`);
  assert(g.steps.filter((s) => s.page).length >= g.steps.length - 1, `${g.id}: a flow is click by click (pages on every step but one)`);
}
{
  const bad = [];
  for (const g of HOWTO_GUIDES) {
    for (const r of g.related) if (!ids.has(r)) bad.push(`${g.id} related ${r}`);
    if (g.nextStep && !ids.has(g.nextStep)) bad.push(`${g.id} nextStep ${g.nextStep}`);
  }
  none(bad, "related and nextStep point at real guides");
}
none(HOWTO_GUIDES.filter((g) => CJK.test(JSON.stringify({ ...g, keywords: [] }))).map((g) => g.id), "guides are English (keywords may carry other languages)");

// The owner's scope: these guides must exist.
for (const id of [
  "reply-to-customer", "send-template", "assign-conversation", "resolve-conversation", "internal-note", "contact-remarks", "find-conversation", "contacts-add-find",
  "queues-waiting", "reply-speed-dashboard", "chat-review",
  "campaign-explained", "broadcast-explained", "create-template", "departments", "team-users-roles", "module-access", "ai-connector-admin", "morning-brief-settings",
]) assert(ids.has(id), `scope guide ${id} exists`);
// Campaigns / broadcasts are explained only (owner: never automate).
for (const g of HOWTO_GUIDES.filter((x) => /campaign|broadcast/.test(x.id) && x.kind === "task")) assert(g.explainOnly === true, `${g.id} is explain-only`);

// ── gates follow Connect's current RBAC ──
{
  const guards = appGuards();
  const bad = [];
  for (const [route, gate] of Object.entries(T.PAGE_GATES)) {
    if (!routeExists(route)) bad.push(`${route}: not a page`);
    const app = guards[route];
    if (!app) continue;
    if (app.module && gate.module !== app.module) bad.push(`${route}: app requireModule("${app.module}") vs gate ${JSON.stringify(gate)}`);
    if (app.admin && !gate.admin) bad.push(`${route}: app requireAdmin() vs gate ${JSON.stringify(gate)}`);
  }
  // Every guarded page a guide could send people to is in PAGE_GATES.
  for (const [route, g] of Object.entries(guards)) if ((g.module || g.admin) && !T.PAGE_GATES[route] && !route.includes(":") && HOWTO_GUIDES.some((x) => x.page === route)) bad.push(`${route}: guarded but no gate`);
  none(bad, "page gates equal the requireModule / requireAdmin guards in src/app");
  // Regression (audit 2026-11-28): /inbox, /contacts, /internal and /settings/auto-assign
  // had a module in PAGE_GATES but no requireModule in src/app, so unticking the module
  // only hid the menu entry — the page still opened by URL. Every module gate must be
  // enforced by the app itself, not just described here.
  const unguarded = Object.entries(T.PAGE_GATES)
    .filter(([route, gate]) => gate.module && guards[route]?.module !== gate.module)
    .map(([route, gate]) => `${route}: gate needs "${gate.module}" but the page has no requireModule("${gate.module}")`);
  none(unguarded, "every module gate is enforced by requireModule in the page or its layout");
}
{
  const allMods = [...ALL_MODULES];
  const v = (role, modules = allMods) => ({ role, modules, caps: T.capsFor(role, []), company: "Demo Co" });
  const agent = v("AGENT");
  const driver = v("DRIVER", ["inbox", "internal"]);
  const manager = v("MANAGER");
  const admin = v("ADMIN");
  const sa = v("SUPER_ADMIN");
  const g = (id) => HOWTO_GUIDES.find((x) => x.id === id);
  assert(T.canDoGuide(g("reply-to-customer"), agent) && T.canDoGuide(g("reply-to-customer"), driver), "agents and drivers can reply (Service module)");
  assert(!T.canDoGuide(g("contacts-add-find"), driver), "drivers have no Contacts module");
  assert(!T.canDoGuide(g("campaign-explained"), agent) && T.canDoGuide(g("campaign-explained"), manager), "campaigns need the campaigns capability (default: managers and up)");
  assert(!T.canDoGuide(g("team-users-roles"), manager) && T.canDoGuide(g("team-users-roles"), admin), "Team & access needs an admin role (requireAdmin)");
  assert(!T.canDoGuide(g("module-access"), admin) && T.canDoGuide(g("module-access"), sa), "module ticks are Super Admin only");
  assert(!T.canDoGuide(g("roles-permissions"), admin) && T.canDoGuide(g("roles-permissions"), sa), "role matrix changes need manageSys (Super Admin by default)");
  assert(!T.canDoGuide(g("ai-connector-admin"), admin) && T.canDoGuide(g("ai-connector-admin"), v("OWNER")), "connector admin = Super Admin / Owner");
  assert(T.canDoGuide(g("create-template"), agent) && !T.canDoGuide(g("create-template"), v("AGENT", ["inbox"])), "templates follow the settings module");
  assert(T.capsFor("MANAGER", [{ capability: "campaigns", allowed: false }]).has("campaigns") === false, "a company's saved matrix overrides the default");
  assert(T.capsFor("OWNER", []).has("settings"), "OWNER is read as ADMIN in the matrix");
  // Chat content: supervisor gate.
  const forAgent = H.guidesFor(agent).map((x) => x.id);
  assert(!forAgent.includes("chat-review") && H.guidesFor(manager).some((x) => x.id === "chat-review"), "the chat-review guide is shown to supervisors only");
  const ctx = (viewer) => ({ viewer, origin: "https://connect.example" });
  const r = JSON.parse(H.runHowtoTool(ctx(agent), "how_to", { question: "review chat quality complaints" }).result.content[0].text);
  assert(!JSON.stringify(r).includes("\"chat-review\""), "an agent's how_to never returns the chat-review guide");

  // ── tool behaviour ──
  const ans = (viewer, name, args) => {
    const o = H.runHowtoTool(ctx(viewer), name, args);
    return { o, v: o.result.isError ? null : JSON.parse(o.result.content[0].text) };
  };
  let x = ans(agent, "how_to", { question: "how do I send a template when the 24 hour window is closed?" });
  assert(x.v.guides[0].id === "send-template", `template question → send-template (${x.v.guides.map((q) => q.id)})`);
  assert(x.v.guides[0].steps.some((s) => s.link?.includes("?highlight=")), "steps carry ?highlight= links");
  assert(x.v.guides[0].yourCompany === "Demo Co", "the answer names the person's company");
  x = ans(agent, "how_to", { question: "怎么转给别的同事" });
  assert(x.v.guides[0].id === "assign-conversation", `Chinese 转给 → assign (${x.v.guides.map((q) => q.id)})`);
  x = ans(agent, "how_to", { question: "how do I resolve a chat" });
  assert(x.v.guides[0].id === "resolve-conversation", "resolve question → resolve guide");
  x = ans(agent, "how_to", { question: "write an internal note" });
  assert(x.v.guides[0].id === "internal-note", "internal note question → internal-note");
  x = ans(agent, "how_to", { question: "how do I send a campaign" });
  assert(x.v.guides[0].id === "campaign-explained" && x.v.guides[0].explainOnly && x.v.guides[0].canDo === false && x.v.guides[0].note, "campaign → explained only, canDo false with a note for an agent");
  x = ans(agent, "how_to", { question: "xyzzy plugh" });
  assert(x.v.matched === false && x.o.note === H.NO_GUIDE_NOTE, "no match → listed for the gap log");
  x = ans(agent, "how_to", { question: "call me on 012-345 6789 or a@b.com about quux" });
  assert(!x.o.target.includes("6789") && !x.o.target.includes("a@b.com"), "the gap log redacts numbers and emails");
  x = ans(agent, "how_to", { topic: "departments" });
  assert(x.v.guides.length === 1 && x.v.guides[0].id === "departments", "topic = id returns that guide");
  x = ans(agent, "glossary", { term: "HSM" });
  assert(x.v.terms[0].term === "HSM", "glossary HSM");
  x = ans(agent, "glossary", { term: "24h window" });
  assert(x.v.terms[0].term === "24-hour window", "glossary alias");
  x = ans(agent, "explain_error", { text: "Could not start the conversation: blocked" });
  assert(x.v.errors[0].id === "start-conversation-failed", "explain_error start-conversation");
  x = ans(agent, "explain_error", { text: "The 24-hour reply window is closed. WhatsApp will refuse a typed message" });
  assert(x.v.errors[0].id === "window-closed", "explain_error window");
  assert(ans(agent, "explain_error", {}).o.status === 400, "explain_error needs text");
  x = ans(agent, "onboarding", { role: "agent" });
  assert(x.v.days.length === 5 && x.v.days.every((d) => d.guides.length > 0), "onboarding agent has 5 days with guides");
  x = ans(agent, "onboarding", { role: "supervisor" });
  assert(!JSON.stringify(x.v).includes("chat-review"), "an agent's onboarding view hides the supervisor-only guide");
  x = ans(driver, "module_overview", { module: "contacts" });
  assert(x.v.modules[0].canOpen === false && x.v.modules[0].note, "module_overview: driver cannot open Contacts");
  assert(T.connectLink("https://c", "/inbox?view=mine", "Assign") === "https://c/inbox?view=mine&highlight=Assign", "highlight merges into an existing query");
  assert(T.connectLink("https://c", "/inbox/:id", "Assign") === null, "a :param page has no link");
  assert(H.howtoPromptText("how_do_i", { task: "assign a chat" }).includes("how_to"), "how_do_i prompt");
  assert(H.HOWTO_TOOLS.every((t) => t.annotations.readOnlyHint === true), "help tools are read-only");
}

// ── reference data ──
{
  const bad = [];
  for (const m of ref.MODULES) {
    if (!labelInSource(m.sidebar)) bad.push(`${m.id}: sidebar "${m.sidebar}"`);
    for (const p of m.keyPages) {
      if (!routeExists(p.path)) bad.push(`${m.id}: ${p.path}`);
      if (!T.routeOf(p.path)) bad.push(`${m.id}: ${p.path} has no gate`);
      if (!labelInSource(p.label)) bad.push(`${m.id}: "${p.label}"`);
    }
  }
  none(bad, "module overview: pages exist, labels exist");
}
{
  assert(new Set(ref.GLOSSARY.map((t) => t.term.toLowerCase())).size === ref.GLOSSARY.length, "glossary terms unique");
  const bad = [];
  for (const t of ref.GLOSSARY) {
    if (t.page && (!routeExists(t.page) || !T.routeOf(t.page))) bad.push(`${t.term}: ${t.page}`);
    if (CJK.test(t.definition)) bad.push(`${t.term}: not English`);
    for (const l of quotedLabels(t.definition)) if (!labelInSource(l)) bad.push(`${t.term}: "${l}"`);
  }
  for (const want of ["24-hour window", "Template", "HSM", "Assignment", "Department", "Resolved"]) if (!ref.GLOSSARY.some((t) => t.term === want)) bad.push(`missing ${want}`);
  none(bad, "glossary honest and complete");
}
{
  const bad = [];
  for (const o of ref.ONBOARDING)
    for (const d of o.days) {
      for (const gid of d.guides) if (!ids.has(gid)) bad.push(`${o.role}: ${gid}`);
      for (const p of d.pages) if (!routeExists(p) || !T.routeOf(p)) bad.push(`${o.role}: ${p}`);
    }
  none(bad, "onboarding guides and pages exist");
}
{
  const src = corpus().raw;
  const bad = [];
  for (const e of ref.ERRORS) for (const m of e.match) if (!src.includes(m)) bad.push(`${e.id}: "${m}"`);
  none(bad, "every explain_error match is the app's own text");
  assert(new Set(ref.ERRORS.map((e) => e.id)).size === ref.ERRORS.length, "error ids unique");
}

// ── round 5b: explain_screen / where_is / show_me ──
{
  const S = await import("../src/lib/mcp/howto-screen.ts");
  const SH = await import("../src/lib/mcp/howto-shots.ts");
  const { repoFileExists, repoFileSize } = await import("./lib/frontend-honesty.mjs");
  const bad = [];
  for (const sc of S.SCREENS) {
    if (!routeExists(sc.path) || !T.routeOf(sc.path)) bad.push(`${sc.path}: not a page with a gate`);
    for (const l of [sc.sidebar, ...sc.tabs, ...sc.actions.map((a) => a.label)]) if (!labelInSource(l)) bad.push(`${sc.path}: "${l}"`);
  }
  none(bad, "screen map: every page exists, every tab / button label exists in src/");

  const allMods = [...ALL_MODULES];
  const v = (role, modules = allMods) => ({ role, modules, caps: T.capsFor(role, []), company: "Demo Co" });
  const ctx = (viewer) => ({ viewer, origin: "https://connect.example", hasShot: SH.hasShot });
  const j = (o) => JSON.parse(o.result.content[0].text);
  let x = j(S.runScreenTool(ctx(v("AGENT")), "where_is", { thing: "where do I assign a chat to someone" }));
  assert(x.places[0].press === "Assign", `where_is assign → Assign (${x.places.map((p) => p.press)})`);
  x = j(S.runScreenTool(ctx(v("AGENT")), "where_is", { thing: "overdue chats" }));
  assert(x.places[0].press === "Overdue" && x.places[0].link.includes("highlight=Overdue"), "where_is overdue → the Overdue tab, highlighted");
  x = j(S.runScreenTool(ctx(v("AGENT")), "explain_screen", { path: "https://connect.example/inbox/abc123" }));
  assert(x.screen.path === "/inbox/:id", "explain_screen maps a conversation URL to the conversation screen");
  x = j(S.runScreenTool(ctx(v("AGENT")), "explain_screen", { labels: ["Invite person", "Access requests"] }));
  assert(x.screen.path === "/settings/team" && x.screen.canOpen === false && x.screen.note, "explain_screen by labels; Team & access closed to an agent");
  assert(S.runScreenTool(ctx(v("AGENT")), "where_is", {}).status === 400, "where_is needs a thing");

  // Screenshots: fresh, on disk, inside the picture, demo only.
  const targets = SH.helpShotTargets();
  const tByPage = new Map(targets.map((t) => [t.page, new Set(t.labels)]));
  const sbad = [];
  for (const [page, shot] of Object.entries(SH.SHOTS)) {
    if (!tByPage.has(page)) sbad.push(`${page}: no longer a target page`);
    if (!repoFileExists(`public/help-shots/${shot.file}`) || repoFileSize(`public/help-shots/${shot.file}`) < 2000) sbad.push(`${page}: ${shot.file} missing`);
    if (!/\.webp$/.test(shot.file)) sbad.push(`${page}: not a WebP`);
    for (const [label, [bx, by, bw, bh]] of Object.entries(shot.boxes)) {
      if (!tByPage.get(page)?.has(label)) sbad.push(`${page}: stale box "${label}"`);
      if (!labelInSource(label)) sbad.push(`${page}: "${label}" not in src/`);
      if (bx < 0 || by < 0 || bw <= 0 || bh <= 0 || bx + bw > shot.w + 1 || by + bh > shot.h + 1) sbad.push(`${page}: box "${label}" outside the picture`);
    }
  }
  none(sbad, "show_me boxes stay fresh (current pages and labels, files on disk, inside the picture)");
  const shotPages = Object.keys(SH.SHOTS);
  assert(shotPages.length >= 10, `screenshots captured for the main screens (${shotPages.length})`);
  for (const must of [["/inbox", "Overdue"], ["/inbox/:id", "Assign"], ["/inbox/:id", "Resolve"], ["/settings/ai-connector", "AI Connector"]]) assert(SH.hasShot(must[0], must[1]), `a screenshot boxes "${must[1]}" on ${must[0]}`);

  // show_me resolution follows the person's access.
  const agent = v("AGENT");
  let hit = SH.resolveShot({ guide_id: "assign-conversation", step: 2 }, agent);
  assert(hit && hit.page === "/inbox/:id" && hit.label === "Assign", "show_me guide step → the Assign box in an open conversation");
  hit = SH.resolveShot({ path: "/inbox", label: "Overdue" }, agent);
  assert(hit && hit.label === "Overdue", "show_me path + label");
  assert(SH.resolveShot({ path: "/settings/team", label: "Invite person" }, agent) === null, "show_me never shows a page the person cannot open");
  assert(SH.resolveShot({ guide_id: "chat-review" }, agent) === null, "show_me hides supervisor-only guides from agents");
  hit = SH.resolveShot({ label: "Assign" }, agent);
  assert(hit && hit.label === "Assign", "show_me by label alone");
  const t = SH.showMeText(hit, "https://connect.example", "https://connect.example/api/mcp/shot?x");
  assert(t.box.imageWidth > 0 && t.note.includes("test data") && t.annotatedImage, "show_me text: box, test-data note, annotated link");

  // The 15-minute link: signed, expires, the box comes from the data.
  const link = await SH.signShotLink("https://connect.example", hit, "s3cret", 1_767_225_600_000);
  const q = new URL(link).searchParams;
  assert((await SH.verifyShotLink(q, "s3cret", 1_767_225_600_000 + 60_000)).label === "Assign", "a fresh shot link verifies");
  assert((await SH.verifyShotLink(q, "s3cret", 1_767_225_600_000 + 16 * 60_000)) === "expired", "a shot link expires after 15 minutes");
  assert((await SH.verifyShotLink(q, "other", 1_767_225_600_000)) === "invalid", "a shot link with the wrong key is refused");
  const forged = new URLSearchParams(q);
  forged.set("l", "Resolve");
  assert((await SH.verifyShotLink(forged, "s3cret", 1_767_225_600_000)) === "invalid", "changing the label breaks the signature");
  const html = SH.annotatedHtml(hit, "/help-shots/x.webp");
  assert(!/<svg|<script/i.test(html) && html.includes("<img") && html.includes("test data"), "the annotated page is an <img> + CSS box, no SVG, no script");
  assert(SH.SHOW_ME_TOOL.annotations.readOnlyHint === true, "show_me is read-only");
  // Help data never names a real person: the demo seed only uses invented names.
  const seed = (await import("node:fs")).readFileSync(new URL("./help-shots-demo.ts", import.meta.url), "utf8");
  assert(!/@(gmail|houzscentury)\.com/.test(seed) && /\(demo\)/.test(seed), "the screenshot seed holds only invented demo people");
}

console.log(`smoke-mcp-howto: ${n} assertions passed (${HOWTO_GUIDES.length} guides, ${ref.GLOSSARY.length} terms, ${ref.ERRORS.length} errors)`);

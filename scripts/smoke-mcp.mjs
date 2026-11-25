// Pure smoke for the AI Connector (src/lib/mcp/*): PKCE, redirect-URI rule,
// path gating, secret stripping, reply cap, discovery, the endpoint catalogue,
// the runtime DDL matching migration 0027, and — the read-only guarantee — that
// nothing the MCP handler can reach imports a "use server" module.
// No DB, no network.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const core = await import("../src/lib/mcp/core.ts");

// ── PKCE: RFC 7636 Appendix B vector ──
assert(
  (await core.pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")) === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  "PKCE S256 matches the RFC 7636 test vector"
);
assert(core.validCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "RFC verifier is well-formed");
assert(!core.validCodeVerifier("short"), "a 5-char verifier is refused");
assert(!core.validCodeVerifier("a".repeat(129)), "a 129-char verifier is refused");
assert(core.validCodeChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), "RFC challenge is well-formed");
assert(!core.validCodeChallenge("plain-text"), "a plain challenge is refused");

// ── Redirect URI rule: https anywhere, http only on loopback ──
assert(core.validRedirectUri("https://claude.ai/api/mcp/auth_callback"), "https is allowed");
assert(core.validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), "ChatGPT callback is allowed");
assert(core.validRedirectUri("http://localhost:6274/oauth/callback"), "http localhost is allowed");
assert(core.validRedirectUri("http://127.0.0.1:33418/cb"), "http 127.0.0.1 is allowed");
assert(core.validRedirectUri("http://[::1]:8080/cb"), "http [::1] is allowed");
assert(!core.validRedirectUri("http://evil.example/cb"), "plain http elsewhere is refused");
assert(!core.validRedirectUri("http://localhost.evil.example/cb"), "a localhost lookalike is refused");
assert(!core.validRedirectUri("https://claude.ai/cb#frag"), "a fragment is refused");
assert(!core.validRedirectUri("https://user:pw@claude.ai/cb"), "credentials in the URI are refused");
assert(!core.validRedirectUri("javascript:alert(1)"), "javascript: is refused");
assert(!core.validRedirectUri("not a url"), "garbage is refused");
assert(!core.validRedirectUri("https://x.example/" + "a".repeat(600)), "an over-long URI is refused");

// ── Path gating ──
const ok = (p) => core.classifyPath(p).ok;
assert(ok("/conversations") && ok("/contacts/abc123") && ok("/dashboard/summary"), "catalogue paths pass");
assert(core.classifyPath("/contacts/").path === "/contacts", "a trailing slash is dropped");
assert(core.classifyPath("/contacts?q=x").path === "/contacts", "the query string is dropped");
for (const p of [
  "/internal",
  "/internal/abc",
  "/settings/developers",
  "/settings",
  "/Settings/developers",
  "/login",
  "/api/v1/contacts",
  "/api/mcp",
  "/mcp",
  "/it-support/tickets",
  "/webhooks/erp",
  "/session/handoff",
]) {
  assert(!ok(p), `blocked: ${p}`);
}
for (const p of ["contacts", "/contacts/../settings", "//contacts", "/contacts/%2e%2e", "/contacts\\x", "/a b", 42, null, "/" + "a".repeat(250)]) {
  assert(!ok(p), `invalid: ${JSON.stringify(p)}`);
}
assert(JSON.stringify(core.matchPattern("/conversations/:id", "/conversations/abc_1-2")) === '{"id":"abc_1-2"}', "pattern captures an id");
assert(core.matchPattern("/conversations/:id", "/conversations") === null, "wrong length does not match");
assert(core.matchPattern("/conversations/:id", "/conversations/a.b") === null, "an id with a dot is refused");

// ── Secret stripping ──
const { value, removed } = core.redactSecrets({
  name: "Wong",
  password: "x",
  nested: { api_key: "k", apiKey: "k", access_token: "t", totp_secret: "s", ok: 1, list: [{ password_hash: "h", body: "hi" }] },
  session_pass: "p",
  amount: 12,
  at: new Date("2026-11-25T00:00:00Z"),
});
const flat = JSON.stringify(value);
for (const k of ["password", "api_key", "apiKey", "access_token", "totp_secret", "password_hash", "session_pass"]) {
  assert(!flat.includes(`"${k}"`), `stripped ${k}`);
  assert(removed.has(k), `reported ${k}`);
}
assert(flat.includes('"name":"Wong"') && flat.includes('"amount":12') && flat.includes('"body":"hi"'), "ordinary fields kept");
assert(flat.includes("2026-11-25T00:00:00.000Z"), "dates serialised");

// ── Reply cap ──
assert(core.MAX_RESULT_CHARS === 30_000, "reply cap is 30k");
const big = core.capText("x".repeat(70_000));
assert(big.cut && big.text.length < 30_000 + 300 && big.text.includes("Reply cut at 30000"), "replies are capped at 30k with a note");
assert(!core.capText("{}").cut, "a small reply is not cut");

// ── Compaction + fitting a list reply under the cap ──
const cp = core.compact({ a: null, b: "", c: [], d: {}, e: { f: null }, g: 0, h: false, i: "x", j: [null, { k: "" }], at: new Date("2026-11-25T00:00:00Z") });
assert(JSON.stringify(cp) === '{"g":0,"h":false,"i":"x","j":[null,{}],"at":"2026-11-25T00:00:00.000Z"}', `compact drops empties, keeps 0 / false / array items (${JSON.stringify(cp)})`);
const rows = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, text: "y".repeat(100), empty: null }));
const fit = core.fitReply({ total: 500, rows }, ["Note A."]);
assert(fit.cut && fit.text.length <= 30_000, `a long list fits under the cap (${fit.text.length})`);
const fitBody = JSON.parse(fit.text.slice(fit.text.indexOf("\n") + 1));
assert(fitBody.total === 500 && fitBody.rows.length === fit.shown && fit.shown > 100 && fit.shown < 500, `whole rows kept, valid JSON (${fit.shown})`);
assert(fit.text.startsWith("Note A. Showing the first") && fit.text.includes(`of 500 rows`), "the note says how many of how many");
assert(!fitBody.rows[0].empty && !("empty" in fitBody.rows[0]), "rows are compacted");
const small = core.fitReply({ a: 1, b: null });
assert(!small.cut && small.text === '{"a":1}', "a small reply is compacted, not cut");
const blob = core.fitReply({ s: "z".repeat(40_000) });
assert(blob.cut && blob.text.includes("Reply cut at 30000"), "a reply with no list falls back to the hard cut");
const topArr = core.fitReply(Array.from({ length: 400 }, () => ({ t: "q".repeat(120) })));
assert(topArr.cut && topArr.text.length <= 30_000 && JSON.parse(topArr.text.slice(topArr.text.indexOf("\n") + 1)).length === topArr.shown, "a top-level array is trimmed too");

// ── Quick answers, search / fetch, prompts (src/lib/mcp/quick.ts) ──
const quick = await import("../src/lib/mcp/quick.ts");
assert(quick.pctChange(110, 100) === 10 && quick.pctChange(5, 0) === null && quick.pctChange(90, 120) === -25, "percent change");
assert(quick.dur(252) === "4m 12s" && quick.dur(null) === null, "durations read as text");
const now = Date.parse("2026-11-25T10:00:00Z");
const inbox = quick.summariseInbox(
  [
    { status: "OPEN", channel: "Delivery line", agent: "Ann", n: 5, unread: 2, waiting: 3, oldestWaitingAt: new Date("2026-11-25T08:00:00Z") },
    { status: "OPEN", channel: "Service line", agent: null, n: 4, unread: 4, waiting: 4, oldestWaitingAt: "2026-11-25T09:30:00Z" },
    { status: "PENDING", channel: "Delivery line", agent: "Ann", n: 2, unread: 0, waiting: 0, oldestWaitingAt: null },
  ],
  { messagesInToday: 12, messagesOutToday: 9, messagesIn7d: 80, messagesOut7d: 70, newConversationsToday: 3, newConversations7d: 20, contactsAddedToday: 1, contactsAdded7d: 6 },
  [{ id: "v1", customer: "Wong", assignedTo: null, channel: "Delivery line", since: new Date("2026-11-25T08:00:00Z") }],
  now
);
assert(inbox.notClosed === 11 && inbox.waitingForUs === 7 && inbox.withUnread === 6, "inbox totals summed");
assert(inbox.byStatus.OPEN === 9 && inbox.byStatus.PENDING === 2, "inbox by status");
assert(inbox.longestWait === "2h", `longest wait is the oldest group (${inbox.longestWait})`);
assert(inbox.byAgent[0].name === "(unassigned)" && inbox.byAgent[0].waiting === 4 && inbox.byAgent[1].name === "Ann" && inbox.byAgent[1].open === 7, "by person, most waiting first, unassigned named");
assert(inbox.byChannel.find((c) => c.name === "Delivery line").open === 7, "by channel");
assert(inbox.today.messagesIn === 12 && inbox.last7Days.contactsAdded === 6, "today / 7 days");
assert(inbox.longestWaiting[0].waiting === "2h" && inbox.longestWaiting[0].assignedTo === "(unassigned)", "longest waiting list");
const noContacts = quick.summariseInbox([], { messagesInToday: 0, messagesOutToday: 0, messagesIn7d: 0, messagesOut7d: 0, newConversationsToday: 0, newConversations7d: 0, contactsAddedToday: null, contactsAdded7d: null }, [], now);
assert(!("contactsAdded" in noContacts.today) && noContacts.longestWait === null, "no contacts module → no contacts figure");
assert(JSON.stringify(inbox).length < 1500, `inbox overview is small (${JSON.stringify(inbox).length} chars)`);
const svc = quick.summariseService(
  { days: 7, label: "19 Nov – 25 Nov 2026" },
  { asked: 40, answered: 36, answeredHuman: 30, avgFirst: 300, avgReply: 125, businessHours: true, byAgent: new Map([["m1", { first: [60, 120], all: [60, 120, 180] }], ["m2", { first: [600], all: [600] }]]) },
  { total: 50, by: { OPEN: 20, CLOSED: 30 } },
  { total: { inbound: 300, outbound: 250 }, prev: { inbound: 250, outbound: 250 } },
  new Map([["m1", "Ann"], ["m2", "Bob"]])
);
assert(svc.replies.replyRatePct === 90 && svc.replies.avgFirstReply === "5m" && svc.replies.avgReply === "2m 5s" && svc.replies.timing === "business hours only", "service reply figures");
assert(svc.byPerson[0].name === "Ann" && svc.byPerson[0].replies === 3 && svc.byPerson[0].avgReply === "2m" && svc.byPerson[1].avgFirstReply === "10m", "service by person");
assert(svc.messages.changePct === 10 && svc.conversationsByStatus.CLOSED === 30, "service volume vs previous period");

assert(JSON.stringify(quick.parseFetchId("conversation:abc_1-2")) === '{"kind":"conversation","rowId":"abc_1-2"}', "fetch id parsed");
assert(quick.parseFetchId("contact:x1")?.kind === "contact", "contact fetch id");
for (const bad of ["payment:x", "conversation:", "conversation:a/b", "conversation:../x", "x", null, 42, "contact:" + "a".repeat(65)]) assert(quick.parseFetchId(bad) === null, `bad fetch id refused: ${bad}`);
const sr = quick.searchResult("https://chat.x", "conversation", "v1", "Conversation:   Wong\n(open)");
assert(JSON.stringify(Object.keys(sr)) === '["id","title","url"]', "a search result is exactly {id, title, url}");
assert(sr.id === "conversation:v1" && sr.url === "https://chat.x/inbox/open/v1" && sr.title === "Conversation: Wong (open)", "search result values");
assert(quick.recordUrl("https://chat.x", "contact", "c1") === "https://chat.x/contacts?id=c1", "contact url");
const cdoc = quick.conversationDoc({
  status: "OPEN",
  assignedTo: "Ann",
  tags: ["VIP"],
  customer: { id: "c1", name: "Wong", phone: "6011", fields: { ref_1: "SO-1", empty: "" } },
  messages: [{ at: "2026-11-25T08:00:00.000Z", from: "customer", text: "Where is my sofa?" }],
  internalNotes: [{ at: "2026-11-25T08:05:00.000Z", by: "Ann", text: "Checked with driver" }],
});
assert(cdoc.title === "Conversation with Wong" && cdoc.text.includes("[2026-11-25 08:00] customer: Where is my sofa?") && cdoc.text.includes("Internal notes:"), "conversation as text");
assert(cdoc.text.includes("ref_1: SO-1") && !cdoc.text.includes("empty:") && cdoc.metadata.customerId === "c1", "conversation fields + metadata");
const kdoc = quick.contactDoc({ name: "Wong", phone: "6011", fields: { "Order no": "SO-1" }, recentConversations: [{ id: "v1", status: "OPEN", lastMessageAt: "2026-11-25T08:00:00.000Z", lastMessage: "hi" }] });
assert(kdoc.title === "Contact Wong" && kdoc.text.includes("Order no: SO-1") && kdoc.text.includes("conversation:v1"), "contact as text");

assert(quick.PROMPTS.length === 3 && quick.PROMPTS.every((p) => p.name && p.title && p.description && Array.isArray(p.arguments)), "three prompts");
assert(quick.promptText("inbox_today", {}).includes("inbox_overview"), "inbox prompt names its quick answer");
assert(quick.promptText("service_review", { days: "30" }).includes("days=30") && quick.promptText("service_review", { days: "999" }).includes("days=7"), "service prompt days bounded");
assert(quick.promptText("find_customer", { who: "Wong" }).includes('"Wong"') && quick.promptText("nope", {}) === null, "find prompt / unknown prompt");

// ── Origin + discovery ──
assert(core.originFor("chat.houzscentury.com", "http://chat.houzscentury.com/x") === "https://chat.houzscentury.com", "public host is https");
assert(core.originFor("localhost:3000", "http://localhost:3000/x") === "http://localhost:3000", "dev server keeps http");
const pr = core.protectedResourceMetadata("https://chat.hookka.com");
assert(pr.resource === "https://chat.hookka.com/api/mcp" && pr.authorization_servers[0] === "https://chat.hookka.com", "protected-resource metadata");
const as = core.authorizationServerMetadata("https://c.example");
assert(as.code_challenge_methods_supported.join() === "S256" && as.token_endpoint_auth_methods_supported.join() === "none", "auth-server metadata: S256, public clients");
assert(as.registration_endpoint === "https://c.example/api/mcp/oauth/register", "registration endpoint");
assert(core.MCP_PROTOCOL_VERSIONS.join() === "2025-06-18,2025-03-26,2024-11-05", "protocol versions");
assert(core.isMcpAdminRole("SUPER_ADMIN") && core.isMcpAdminRole("OWNER") && !core.isMcpAdminRole("ADMIN") && !core.isMcpAdminRole("AGENT"), "admin roles");
assert(core.esc(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;", "HTML escaping");
assert(core.appLabel("Claude") === "Claude" && core.appLabel("ChatGPT connector") === "ChatGPT" && core.appLabel("") === "AI app", "app labels");

// ── Catalogue ──
const reads = await import("../src/lib/mcp/reads.ts");
const { MODULES } = await import("../src/lib/module-access.ts");
for (const ep of reads.ENDPOINTS) {
  assert(core.classifyPath(ep.path.replace(/:id/g, "x1")).ok, `endpoint ${ep.path} is not blocked`);
  assert(MODULES.includes(ep.module), `endpoint ${ep.path} belongs to a real module`);
  assert(reads.findEndpoint(ep.path.replace(/:id/g, "x1"))?.ep === ep, `endpoint ${ep.path} is found by its own path`);
}
assert(reads.findEndpoint("/nope") === null, "unknown path finds nothing");
assert(!reads.ENDPOINTS.some((e) => e.module === "internal" || e.module === "settings"), "no internal-chat or settings endpoint");
assert(reads.listEndpointPaths().every((p) => !p.includes(":")), "leak check reads only parameter-free lists");
assert(reads.moduleCatalog(["inbox"]).every((m) => m.module === "inbox"), "module catalogue follows the person's modules");

// ── Runtime DDL == migration 0027 ──
const { MCP_DDL } = await import("../src/db/ensure-mcp.ts");
const mig = readFileSync(resolve(root, "src/db/migrations/0027_mcp_connector.sql"), "utf8");
for (const t of ["mcp_access", "mcp_access_requests", "mcp_oauth_clients", "mcp_auth_requests", "mcp_oauth_codes", "mcp_tokens", "mcp_calls"]) {
  assert(MCP_DDL.some((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS "connect"."${t}"`)), `ensure creates ${t}`);
}
for (const s of MCP_DDL) assert(mig.includes(s), `migration carries: ${s.slice(0, 60)}`);
const journal = JSON.parse(readFileSync(resolve(root, "src/db/migrations/meta/_journal.json"), "utf8"));
assert(journal.entries.some((e) => e.tag === "0027_mcp_connector"), "0027 is in the journal");

// ── Read-only by construction: nothing reachable from the MCP handlers imports a "use server" module ──
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = resolve(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, base + ".ts", base + ".tsx", resolve(base, "index.ts")]) if (existsSync(c) && !c.endsWith("\\") && /\.(ts|tsx)$/.test(c)) return c;
  return null;
}
const seen = new Set();
const offenders = [];
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  if (/^\s*["']use server["']/.test(src)) offenders.push(file.slice(root.length + 1));
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) {
    const f = resolveImport(file, m[1]);
    if (f) walk(f);
  }
}
for (const entry of [
  "src/app/api/mcp/route.ts",
  "src/app/api/mcp/oauth/register/route.ts",
  "src/app/api/mcp/oauth/token/route.ts",
  "src/app/api/mcp/oauth/authorize/route.ts",
  "src/lib/mcp/admin.ts",
]) {
  walk(resolve(root, entry));
}
assert(seen.size > 10, `the import walk found the MCP modules (${seen.size} files)`);
assert(offenders.length === 0, `no "use server" module is reachable from the connector: ${offenders.join(", ")}`);
// The app's own auth never accepts a connector token.
for (const f of ["src/lib/current-member.ts", "src/lib/api-keys.ts"]) {
  const src = readFileSync(resolve(root, f), "utf8");
  assert(!/hcmcp/i.test(src) && !/mcp_tokens/.test(src), `${f} knows nothing of connector tokens`);
}
assert(!"hcmcp_x".startsWith("hc_"), "a connector token cannot pass the API-key prefix check");

console.log(`smoke-mcp: ok (${n} assertions, ${seen.size} files walked)`);

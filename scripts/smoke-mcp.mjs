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


// ── Round 3 (owner 2026-11-26): reply speed, delivery, campaigns, mood scan gate, daily brief, export, rate limit ──
const r3 = await import("../src/lib/mcp/round3.ts");
const xl = await import("../src/lib/mcp/xlsx.ts");
const { inflateRawSync } = await import("node:zlib");

// Dates
assert(r3.myToday(Date.parse("2026-11-25T17:30:00Z")) === "2026-11-26", "Malaysia today");
assert(r3.shiftDay("2026-03-01", -1) === "2026-02-28" && r3.myMidnight("2026-11-26").toISOString() === "2026-11-25T16:00:00.000Z", "day helpers");
const NOW3 = Date.parse("2026-11-26T04:00:00Z");
const dr = r3.dayRange(undefined, undefined, 7, NOW3);
assert(dr.from === "2026-11-26" && dr.to === "2026-11-26" && dr.start.toISOString() === "2026-11-25T16:00:00.000Z" && dr.end.toISOString() === "2026-11-26T16:00:00.000Z", "default range = today");
assert(r3.dayRange("2026-11-20", "2026-11-26", 7, NOW3).from === "2026-11-20", "7 days allowed");
assert("error" in r3.dayRange("2026-11-19", "2026-11-26", 7, NOW3), "8 days refused");
assert("error" in r3.dayRange("bad", undefined, 7, NOW3) && "error" in r3.dayRange("2026-11-26", "2026-11-20", 7, NOW3), "bad / reversed range refused");
assert(r3.dayRange("2026-11-26", "2026-12-31", 7, NOW3).to === "2026-11-26", "future end clamped to today");

// Mood scan gate: Connect's admin roles + MANAGER only
for (const role of ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"]) assert(r3.moodScanAllowed(role), `mood scan allowed for ${role}`);
for (const role of ["AGENT", "SALES", "VIEWER", "DRIVER", "", null, undefined, "admin"]) assert(!r3.moodScanAllowed(role), `mood scan refused for ${role}`);
assert(r3.MOOD_SCAN_REFUSAL.startsWith("Supervisors and admins only"), "plain refusal text");
assert(r3.maskPhone("60123456789") === "60•••••6789" && r3.maskPhone("123") === "•••" && r3.maskPhone("") === "", "phones masked");
assert(r3.keywordHints("I want a REFUND, still waiting!").join() === "refund,still waiting" && r3.keywordHints("还没送到，我要投诉").includes("投诉"), "keyword hints (EN / ZH)");

// Mood scan grouping: most active first, clipped, capped, flags
const T = (m) => new Date(NOW3 - m * 60_000).toISOString();
const convos3 = new Map([
  ["c1", { id: "c1", customer: "Wong", status: "OPEN", assignedTo: "Ann", department: "Service", channel: "Main", lastReplyAt: T(120), lastMessageAt: T(50), lastFromCustomer: true }],
  ["c2", { id: "c2", customer: "Lim", status: "OPEN", assignedTo: null, department: null, channel: "Main", lastReplyAt: T(1), lastMessageAt: T(1), lastFromCustomer: false }],
]);
const msgs3 = [
  { conversationId: "c1", at: T(100), text: "Hello?", type: "TEXT" },
  { conversationId: "c1", at: T(70), text: "Still waiting for my refund " + "x".repeat(400), type: "TEXT" },
  { conversationId: "c1", at: T(50), text: "", type: "IMAGE" },
  { conversationId: "c2", at: T(5), text: "Thanks!", type: "TEXT" },
  { conversationId: "zz", at: T(5), text: "not visible", type: "TEXT" },
];
const ms = r3.buildMoodScan(msgs3, convos3, { from: "2026-11-26", to: "2026-11-26" }, NOW3);
assert(ms.conversations === 2 && ms.byConversation[0].conversationId === "c1" && ms.inboundMessages === 4, "most active conversation first; unknown conversations dropped");
const f1 = ms.byConversation[0].flags;
assert(f1.unansweredInARow === 3 && f1.repeatedWithoutReply && f1.overSla && f1.waiting === "50m" && f1.keywordHints.includes("refund"), `flags (${JSON.stringify(f1)})`);
assert(ms.byConversation[0].messages[1].text.length === r3.MOOD_TEXT_CHARS + 1 && ms.byConversation[0].messages[2].text === "[image]", "text clipped; media shown by type");
assert(!ms.byConversation[1].flags.overSla && !ms.byConversation[1].flags.repeatedWithoutReply, "answered conversation not flagged");
assert(ms.instructions.includes("Do not repeat the messages"), "tells the AI to summarise, not dump");
const many = Array.from({ length: 300 }, (_, i) => ({ conversationId: "c1", at: T(i), text: `m${i}`, type: "TEXT" }));
assert(r3.buildMoodScan(many, convos3, { from: "a", to: "b" }, NOW3).messagesShown === r3.MOOD_MAX_MESSAGES, "at most 200 messages");

// Reply speed: per member from the dashboard's replyStats shape, waiting over SLA
const RS = (first, all, byAgent) => ({ asked: 10, answered: 9, answeredHuman: 8, avgFirst: first, avgReply: all, businessHours: false, byAgent: new Map(byAgent) });
const rs = r3.summariseReplySpeed(
  { today: RS(300, 120, [["u1", { first: [300], all: [120, 120] }]]), yesterday: RS(600, 200, []), last7: RS(2400, 900, [["u1", { first: [300], all: [120] }], ["u2", { first: [3600], all: [3600] }]]) },
  new Map([["u1", "Ann"], ["u2", "Bob"]]),
  [{ id: "v9", customer: "Wong", assignedTo: null, department: "Service", channel: "Main", since: T(45) }],
  1,
  NOW3
);
assert(rs.slaMinutes === r3.SLA_MINUTES && rs.today.replyRatePct === 90 && rs.today.avgFirstHumanReply === "5m" && rs.firstReplyTodayVsYesterdayPct === -50, `reply speed windows (${JSON.stringify(rs.today)})`);
assert(rs.byMember.find((p) => p.name === "Bob").firstReplyOverSla7d === true && rs.byMember.find((p) => p.name === "Ann").repliesToday === 2, "per member, slow one flagged");
assert(rs.waitingOverSla.count === 1 && rs.waitingOverSla.longest[0].waiting === "45m" && rs.waitingOverSla.longest[0].assignedTo === "(unassigned)", "waiting over SLA");

// Delivery + campaigns
const dv = r3.summariseDelivery({ sent: 10, delivered: 8, read: 5, failed: 1, waiting: 1 }, [{ id: "x", createdAt: "t", conversationId: "v", customer: "W", type: "TEXT", sendError: null }], new Map([["x", "131026 · Undeliverable"]]), 7, 200);
assert(dv.todayOutbound.deliveredPct === 80 && dv.failed.count === 1 && dv.failed.byReason["131026 · Undeliverable"] === 1, "delivery summary");
const cs = r3.summariseCampaigns([{ name: "A", status: "sent", stats: { total: 100, sent: 98, failed: 2 } }, { name: "B", status: "draft", stats: null }]);
assert(cs.campaigns === 2 && cs.totals.sent === 98 && cs.byStatus.sent === 1, "campaign summary");

// Daily brief: a refused part says so; the rest answers
const db3 = r3.buildDailyBrief(
  {
    overview: { ok: true, value: { waitingForUs: 3, longestWait: "2h", byAgent: [{ name: "Ann", open: 2, waiting: 1 }, { name: "(unassigned)", open: 1, waiting: 1 }], longestWaiting: [{ id: "v1", customer: "Wong" }], today: { messagesIn: 4 } } },
    mine: { ok: true, value: { conversations: [{ id: "v1", customer: "Wong", status: "OPEN", waitingOnUs: true, unread: 2, lastMessage: { at: "t" } }, { id: "v2", customer: "Lim", status: "OPEN", waitingOnUs: false, unread: 0 }] } },
    payments: { ok: false, message: "You do not have access to payments in Houzs Connect." },
    delivery: { ok: true, value: { todayOutbound: { sent: 1 }, failed: { count: 0, latest: [] } } },
  },
  { name: "Ann" },
  "https://chat.x"
);
assert(db3.myConversations.waitingForMyReply === 1 && db3.myConversations.top[0].url === "https://chat.x/inbox/open/v1", "brief: my conversations waiting");
assert(db3.inbox.mine.waiting === 1 && db3.inbox.unassignedWaiting === 1, "brief: inbox for me + unassigned");
assert(db3.paymentsToCheck.unavailable.includes("do not have access"), "brief: refused part says so");
assert(r3.DAILY_BRIEF_PROMPT.name === "daily-brief" && r3.DAILY_BRIEF_TEXT.includes("daily_brief"), "daily-brief prompt");

// Export: allowlist, no message text column, money in RM, columns picked
assert(Object.keys(r3.EXPORT_LISTS).join() === "conversations,contacts,payments,logs,campaigns", "export allowlist");
for (const [k, l] of Object.entries(r3.EXPORT_LISTS)) {
  assert(!l.columns.some((c) => /text|body|message$/i.test(c.key)), `export ${k} carries no message text`);
  assert(reads.findEndpoint(l.path) && !l.path.includes(":"), `export ${k} reads a catalogue list`);
}
assert(r3.EXPORT_LISTS.payments.columns.find((c) => c.key === "amount").kind === "money", "payment amount exported as RM money");
assert(r3.pickColumns(r3.EXPORT_LISTS.payments.columns, ["Customer", "amount"]).map((c) => c.key).join() === "customer,amount", "fields pick columns in list order");
assert(r3.pickColumns(r3.EXPORT_LISTS.payments.columns, ["nope"]).length === r3.EXPORT_LISTS.payments.columns.length, "unknown fields → all columns");
const er = r3.exportRows([{ lastMessage: { at: "2026-11-26T01:00:00Z" }, waitingOnUs: true }], r3.EXPORT_LISTS.conversations.columns);
assert(er[0].lastMessageAt === "2026-11-26T01:00:00Z" && er[0].waitingOnUs === "yes", "export rows flattened");
assert(r3.exportFileName("payments", "2026-11-26") === "connect-payments-2026-11-26.xlsx", "export file name");

// xlsx: a real zip with CRCs, header, money, dates
const xbytes = await xl.buildXlsx("Payments", [{ key: "c", header: "Customer" }, { key: "a", header: "Amount (RM)", kind: "money" }, { key: "t", header: "When", kind: "date" }], [{ c: "Wong & <Co>", a: 1234.5, t: "2026-11-25T17:05:00Z" }]);
const xb = Buffer.from(xbytes);
const eocd = xb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const files3 = new Map();
for (let i = 0, p = xb.readUInt32LE(eocd + 16); i < xb.readUInt16LE(eocd + 10); i++) {
  const method = xb.readUInt16LE(p + 10), crc = xb.readUInt32LE(p + 16), csize = xb.readUInt32LE(p + 20), nlen = xb.readUInt16LE(p + 28), off = xb.readUInt32LE(p + 42);
  const name = xb.subarray(p + 46, p + 46 + nlen).toString();
  const data = xb.subarray(off + 30 + xb.readUInt16LE(off + 26), off + 30 + xb.readUInt16LE(off + 26) + csize);
  const raw = method === 8 ? inflateRawSync(data) : data;
  assert(xl.crc32(new Uint8Array(raw)) === crc, `xlsx part ${name} CRC`);
  files3.set(name, raw.toString());
  p += 46 + nlen;
}
assert(files3.size === 6 && files3.has("xl/worksheets/sheet1.xml") && files3.has("[Content_Types].xml"), "xlsx has its six parts");
const sheet3 = files3.get("xl/worksheets/sheet1.xml");
assert(sheet3.includes('<c r="B2" s="2"><v>1234.5</v></c>') && sheet3.includes("Wong &amp; &lt;Co&gt;") && sheet3.includes("2026-11-26 01:05") && sheet3.includes('state="frozen"'), "xlsx sheet: money, escaping, Malaysia time, frozen header");

// Rate limit
assert(r3.RATE_LIMITS.perMinute === 30 && r3.RATE_LIMITS.perDay === 600, "limits 30 / min, 600 / day");
assert(r3.rateLimitMessage({ minute: 29, day: 599 }) === null, "under the limit");
assert(r3.rateLimitMessage({ minute: 30, day: 1 }).startsWith("Too many requests — wait a minute"), "minute limit");
assert(r3.rateLimitMessage({ minute: 0, day: 600 }).startsWith("Daily limit reached"), "daily limit");

// Tool list: the mood scan is listed only to supervisors / admins
const srv = await import("../src/lib/mcp/server.ts");
const allMods = [...MODULES];
assert(srv.toolsFor(allMods, "AGENT").every((t) => t.name !== "customer_mood_scan"), "mood scan hidden from an agent");
assert(srv.toolsFor(allMods, "MANAGER").some((t) => t.name === "customer_mood_scan"), "mood scan listed to a manager");
assert(srv.toolsFor(allMods, "ADMIN").every((t) => !("supervisorOnly" in t) && !("module" in t)), "no internal fields sent");
assert(srv.toolsFor(["inbox"], "ADMIN").every((t) => !["reply_speed", "message_delivery", "contacts_summary", "campaign_summary"].includes(t.name)), "module-bound quick answers follow modules");

// ── Round 4 (owner 2026-11-26): period convention, waiting_now, agent_workload, chat_review, customer_chat_summary, data_gaps ──
const r4 = await import("../src/lib/mcp/round4.ts");
// Friday 2026-11-27, 12:00 Malaysia time.
const FRI = Date.parse("2026-11-27T04:00:00Z");
const prd = (p, from, to, now = FRI) => r4.periodRange(p, from, to, now);
const span = (r) => `${r.from}..${r.to} prev ${r.previous.from}..${r.previous.to}`;
assert(span(prd()) === "2026-11-27..2026-11-27 prev 2026-11-26..2026-11-26" && prd().period === "today", `default = today vs yesterday (${span(prd())})`);
assert(prd("today").previous.end.getTime() - prd("today").previous.start.getTime() === FRI - prd("today").start.getTime(), "today vs yesterday up to the same time");
assert(span(prd("week")) === "2026-11-23..2026-11-27 prev 2026-11-16..2026-11-20", `week = Monday to now vs last Monday to the same weekday (${span(prd("week"))})`);
assert(prd("week").previous.end.toISOString() === "2026-11-20T04:00:00.000Z", "last week ends at the same weekday and time");
assert(span(prd("week", null, null, Date.parse("2026-11-29T15:00:00Z"))) === "2026-11-23..2026-11-29 prev 2026-11-16..2026-11-22", "Sunday still belongs to the week that started Monday");
assert(span(prd("week", null, null, Date.parse("2026-11-29T17:00:00Z"))).startsWith("2026-11-30..2026-11-30"), "Monday 01:00 MYT starts a new week");
assert(span(prd("month")) === "2026-11-01..2026-11-27 prev 2026-10-01..2026-10-27", `month to date (${span(prd("month"))})`);
assert(span(prd("month", null, null, Date.parse("2026-03-31T04:00:00Z"))) === "2026-03-01..2026-03-31 prev 2026-02-01..2026-02-28", "previous month never runs past its own end");
assert(span(prd("last_month")) === "2026-10-01..2026-10-31 prev 2026-09-01..2026-09-30", `last month, whole (${span(prd("last_month"))})`);
assert(span(prd("last_month", null, null, Date.parse("2026-01-15T04:00:00Z"))) === "2025-12-01..2025-12-31 prev 2025-11-01..2025-11-30", "last month across a year end");
assert(span(prd("quarter")) === "2026-10-01..2026-11-27 prev 2026-07-01..2026-08-27", `quarter to date (${span(prd("quarter"))})`);
assert(span(prd("year")) === "2026-01-01..2026-11-27 prev 2025-01-01..2025-11-27", `year to date (${span(prd("year"))})`);
assert(span(prd("custom", "2026-11-01", "2026-11-10")) === "2026-11-01..2026-11-10 prev 2026-10-22..2026-10-31", `custom vs the same number of days before (${span(prd("custom", "2026-11-01", "2026-11-10"))})`);
assert(prd(undefined, "2026-11-20").period === "custom" && prd(undefined, "2026-11-20").to === "2026-11-27", "from alone = custom up to today");
assert(prd("custom", "2026-11-20", "2027-01-01").to === "2026-11-27", "custom never runs into the future");
assert("error" in prd("fortnight") && "error" in prd("custom") && "error" in prd("custom", "2026-11-10", "2026-11-01") && "error" in prd("custom", "2024-01-01", "2026-11-01"), "bad period / missing from / reversed / over 366 days refused");
assert(r4.PERIODS.join() === "today,week,month,last_month,quarter,year,custom", "the seven periods");

// Links next to every conversationId
const linked = r4.addConversationLinks({ a: [{ conversationId: "c1" }, { conversationId: "c 2", url: "keep" }], b: { conversationId: 5 } }, "https://x.test");
assert(linked.a[0].url === "https://x.test/inbox/open/c1" && linked.a[1].url === "keep" && linked.b.url === undefined, "links added beside string conversationIds only");
assert(r4.customerLabel("Wong", "60111111111") === "Wong" && r4.customerLabel("+60 11-1111 1111", "60111111111") === "60•••••1111" && r4.customerLabel(null, "60111111111") === "60•••••1111", "customer label: name, else a masked phone");
assert(r4.chatContentRefusal("chat_review").startsWith("Supervisors and admins only: chat_review"), "chat-content refusal wording matches the mood scan's");

// waiting_now
const wn = r4.summariseWaitingNow(
  [
    { id: "w1", customer: "Wong", status: "OPEN", assignedTo: null, department: "Delivery", channel: "Main", waitingSince: new Date(FRI - 3 * 3600_000), unanswered: 3, lastMessage: "Hello?" },
    { id: "w2", customer: "Lim", status: "QUEUE", assignedTo: "Agent A", department: null, channel: "Main", waitingSince: new Date(FRI - 10 * 60_000), unanswered: 1, lastMessage: "" },
  ],
  2,
  FRI
);
assert(wn.waitingNow === 2 && wn.overSla === 1 && wn.unassigned === 1 && wn.byAssignee["(unassigned)"] === 1, "waiting_now counts");
assert(wn.longestFirst[0].conversationId === "w1" && wn.longestFirst[0].waiting === "3h" && wn.longestFirst[0].overSla && wn.longestFirst[0].assignedTo === "(unassigned)", `waiting_now longest first (${JSON.stringify(wn.longestFirst[0])})`);
assert(!wn.longestFirst[1].overSla && wn.longestFirst[1].lastMessage === null, "under the SLA, empty preview dropped");
assert(r4.summariseWaitingNow(wn.longestFirst.slice(0, 1).map(() => ({ id: "x", customer: "x", status: "OPEN", assignedTo: null, department: null, channel: null, waitingSince: null, unanswered: 1, lastMessage: "" })), 9, FRI).overSla === "0+", "a capped list says +");

// agent_workload
const rt = (asked, answered, first) => ({ asked, answered, answeredHuman: answered, avgFirst: first, avgReply: first, businessHours: false });
const aw = r4.summariseAgentWorkload(
  prd("week"),
  [{ id: "a", name: "Agent A", dept: "Delivery", assigned: 4, open: 2, closed: 2, replied: 12, first: 600, onTime: true, avg: 300 }],
  rt(10, 9, 600),
  rt(8, 8, 1200),
  [{ agentId: "a", open: 3, waiting: 1 }, { agentId: "b", open: 2, waiting: 2 }, { agentId: null, open: 5, waiting: 4 }],
  new Map([["a", "Agent A"], ["b", "Agent B"]])
);
assert(aw.period === "week" && aw.previous.from === "2026-11-16" && aw.team.replyRatePct === 90 && aw.change.avgFirstReplyPct === -50, `agent_workload team vs previous (${JSON.stringify(aw.change)})`);
assert(aw.byAgent[0].name === "Agent A" && aw.byAgent[0].openNow === 3 && aw.byAgent[0].replies === 12 && aw.byAgent[0].avgFirstReply === "10m", `agent row (${JSON.stringify(aw.byAgent[0])})`);
assert(aw.byAgent[1].name === "Agent B" && aw.byAgent[1].replies === 0 && aw.byAgent[1].waitingNow === 2, "someone sitting on chats without replying still shows");
assert(aw.unassignedNow.open === 5 && aw.unassignedNow.waiting === 4, "unassigned right now");

// chat_review: walk + lists + complainers + quality
const TM = (min) => new Date(FRI - min * 60_000);
const rwalk = [
  { conversationId: "v1", direction: "IN", isBot: false, at: TM(300), senderId: null },
  { conversationId: "v1", direction: "OUT", isBot: true, at: TM(299), senderId: null },
  { conversationId: "v1", direction: "IN", isBot: false, at: TM(120), senderId: null },
  { conversationId: "v2", direction: "IN", isBot: false, at: TM(200), senderId: null },
  { conversationId: "v2", direction: "OUT", isBot: false, at: TM(190), senderId: "a" },
  { conversationId: "v3", direction: "IN", isBot: false, at: TM(100), senderId: null },
  { conversationId: "v3", direction: "OUT", isBot: false, at: TM(30), senderId: "a" },
  { conversationId: "v3", direction: "IN", isBot: false, at: TM(20), senderId: null },
  { conversationId: "v4", direction: "OUT", isBot: false, at: TM(10), senderId: "a" },
];
const lines = r4.walkConversations([...rwalk].reverse());
assert(lines.get("v1").unanswered === 2 && lines.get("v1").bot === 1 && lines.get("v1").lastHuman === null, "walk: bot replies do not answer");
assert(lines.get("v3").unanswered === 1 && lines.get("v3").waitStart === TM(20).getTime(), "walk: a new customer message after our reply starts a new wait");
const rc = (id, contactId, status, lastFromCustomer, agent = null) => [id, { id, contactId, customer: `Cust ${id}`, status, assignedTo: agent, department: null, lastFromCustomer }];
const review = r4.buildChatReview(
  prd("week"),
  {
    walk: rwalk,
    prevWalk: [
      { conversationId: "p1", direction: "IN", isBot: false, at: TM(10_000), senderId: null },
      { conversationId: "p1", direction: "OUT", isBot: false, at: TM(9_990), senderId: "a" },
    ],
    convos: new Map([rc("v1", "k1", "OPEN", true), rc("v2", "k2", "CLOSED", false, "Agent A"), rc("v3", "k1", "OPEN", true, "Agent A"), rc("v4", "k4", "OPEN", false)]),
    inbound: [
      { conversationId: "v1", at: TM(300), text: "Where is my sofa? So late" },
      { conversationId: "v1", at: TM(120), text: "Still waiting, I want a refund" },
      { conversationId: "v3", at: TM(100), text: "The table arrived damaged" },
      { conversationId: "v3", at: TM(20), text: "ok thanks" },
      { conversationId: "v2", at: TM(200), text: "What time is delivery?" },
    ],
    lastReplies: [{ conversationId: "v2", at: TM(190), text: "Your delivery is at 3pm tomorrow, our driver will call before arriving at your place", senderId: "a" }],
    names: new Map([["a", "Agent A"]]),
    truncated: false,
  },
  FRI
);
assert(review.quality.customersWhoWrote === 3 && review.quality.replied === 1 && review.quality.notReplied === 2, `chat_review partition (${JSON.stringify(review.quality)})`);
assert(review.notReplied.longestFirst.map((r) => r.conversationId).join() === "v1,v3", "not replied, longest wait first");
const nr1 = review.notReplied.longestFirst[0];
assert(nr1.customerMessagesUnanswered === 2 && nr1.onlyABotAnswered && nr1.waitingNow && nr1.waiting === "5h" && nr1.lastCustomerMessage === "Still waiting, I want a refund", `not replied row (${JSON.stringify(nr1)})`);
assert(review.notReplied.longestFirst[1].waiting === "20m" && !review.notReplied.longestFirst[1].onlyABotAnswered, "waiting measured from the message after our last reply");
const rp = review.replied.latestFirst[0];
assert(rp.conversationId === "v2" && rp.repliedBy === "Agent A" && rp.firstReplyAfter === "10m" && rp.ourLastReply.startsWith("Your delivery is at 3pm") && rp.ourLastReply.length <= 161, `replied row with a snippet (${JSON.stringify(rp)})`);
assert(review.repeatComplainers.length === 1 && review.repeatComplainers[0].customer === "Cust v1" && review.repeatComplainers[0].complaintMessages === 3 && review.repeatComplainers[0].conversations === 2 && review.repeatComplainers[0].stillWaiting, `repeat complainer across two conversations (${JSON.stringify(review.repeatComplainers)})`);
assert(review.quality.negativeMood === 2 && review.quality.unresolved === 2 && review.quality.stillWaitingNow === 2 && review.quality.onlyABotAnswered === 1 && review.quality.firstReplyOverSla === 1, `quality view (${JSON.stringify(review.quality)})`);
assert(review.previousPeriod.customersWhoWrote === 1 && review.previousPeriod.replyRatePct === 100 && review.change.customersWhoWrotePct === 200, "against the previous period");
assert(!JSON.stringify(review).includes("_sort") && review.instructions.includes("Do not paste"), "no internal fields; summarise instruction");

// customer_chat_summary
const chat = r4.summariseCustomerChat(
  {
    id: "v1",
    status: "OPEN",
    assignedTo: null,
    department: "Delivery",
    tags: ["VIP"],
    customer: { name: "Wong Ah Kow", phone: "60111111111", fields: { ref_1: "SO-1", address: "x" } },
    messages: [
      { at: TM(60).toISOString(), from: "Agent A", text: "Hi, how can I help?" },
      { at: TM(40).toISOString(), from: "customer", text: "My sofa is broken" },
      { at: TM(35).toISOString(), from: "customer", text: "x".repeat(400) },
    ],
    internalNotes: [{ at: TM(50).toISOString(), by: "Agent A", text: "Called" }],
  },
  [{ id: "v9", customer: "Wong Ah Kow", phone: "60111111111", status: "CLOSED" }],
  FRI
);
assert(chat.customer === "Wong Ah Kow" && chat.orderRef === "SO-1" && chat.assignedTo === "(unassigned)" && !("address" in chat), "chat summary header (order ref only, no address)");
assert(chat.flags.unansweredInARow === 2 && chat.flags.waiting === "40m" && chat.flags.overSla && chat.flags.keywordHints.includes("broken"), `chat flags (${JSON.stringify(chat.flags)})`);
assert(chat.messages[2].text.length === 301 && chat.otherMatches[0].conversationId === "v9" && !JSON.stringify(chat).includes("60111111111"), "messages clipped, other matches, no phone number");

// data_gaps
const gaps = r4.buildDataGaps({
  contacts: { ok: true, value: { total: 10, noName: { count: 2, examples: [] } } },
  overview: { ok: true, value: { notClosed: 7, byAgent: [{ name: "(unassigned)", open: 3, waiting: 2 }] } },
  unassigned: { ok: true, value: { conversations: [{ id: "c1", customer: "Wong", status: "OPEN", department: null, waitingOnUs: true }] } },
});
assert(gaps.contacts.total === 10 && gaps.conversations.noAgentAssigned === 3 && gaps.conversations.noAgentAssignedAndWaiting === 2 && gaps.conversations.examples[0].department === "(no department)", "data_gaps sections");
assert(r4.buildDataGaps({ contacts: { ok: false, message: "You do not have access to Contacts in Houzs Connect." }, overview: { ok: true, value: {} }, unassigned: { ok: true, value: {} } }).contacts.unavailable.includes("Contacts"), "a part without access says so");

// Round 4 tool list: chat-content tools only to supervisors / admins, module-bound tools follow modules.
for (const name of ["chat_review", "customer_chat_summary", "customer_mood_scan"]) {
  for (const role of ["AGENT", "SALES", "VIEWER", "", null]) assert(srv.toolsFor(allMods, role).every((t) => t.name !== name), `${name} hidden from ${role}`);
  for (const role of ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"]) assert(srv.toolsFor(allMods, role).some((t) => t.name === name), `${name} listed to ${role}`);
}
assert(srv.toolsFor(["contacts", "dashboard"], "MANAGER").every((t) => !["chat_review", "customer_chat_summary", "waiting_now"].includes(t.name)), "chat tools need the inbox module");
assert(srv.toolsFor(["inbox"], "AGENT").some((t) => t.name === "waiting_now") && !srv.toolsFor(["inbox"], "AGENT").some((t) => t.name === "agent_workload"), "waiting_now follows inbox, agent_workload follows dashboard");
// Round 4c P1: a composite tool is listed only when at least one of its modules is on (each part still keeps its own gate).
assert(!srv.toolsFor([], "AGENT").some((t) => t.name === "data_gaps") && srv.toolsFor(["contacts"], "AGENT").some((t) => t.name === "data_gaps"), "data_gaps needs contacts or inbox");

// ── Runtime DDL == migrations 0027 + 0028 + 0029 ──
const { MCP_DDL } = await import("../src/db/ensure-mcp.ts");
const CR = String.fromCharCode(13);
const mig = ["0027_mcp_connector", "0028_mcp_actions", "0029_mcp_proactive"].map((f) => readFileSync(resolve(root, `src/db/migrations/${f}.sql`), "utf8").split(CR).join("")).join(String.fromCharCode(10));
for (const t of ["mcp_access", "mcp_access_requests", "mcp_oauth_clients", "mcp_auth_requests", "mcp_oauth_codes", "mcp_tokens", "mcp_calls", "mcp_settings", "mcp_pending_actions", "mcp_brief_subscriptions", "mcp_proactive_keys", "mcp_proactive_sends"]) {
  assert(MCP_DDL.some((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS "connect"."${t}"`)), `ensure creates ${t}`);
}
for (const s of MCP_DDL) assert(mig.includes(s), `migration carries: ${s.slice(0, 60)}`);
const journal = JSON.parse(readFileSync(resolve(root, "src/db/migrations/meta/_journal.json"), "utf8"));
assert(journal.entries.some((e) => e.tag === "0027_mcp_connector"), "0027 is in the journal");
assert(journal.entries.some((e) => e.tag === "0028_mcp_actions"), "0028 is in the journal");
assert(journal.entries.some((e) => e.tag === "0029_mcp_proactive"), "0029 is in the journal");

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
  "src/app/api/mcp/export/[token]/route.ts",
]) {
  walk(resolve(root, entry));
}
assert(seen.size > 10, `the import walk found the MCP modules (${seen.size} files)`);
assert(offenders.length === 0, `no "use server" module is reachable from the connector: ${offenders.join(", ")}`);
// Round 4b: the connector writes only through lib/inbox-writes.ts; no campaign / broadcast sender or contact import is reachable.
assert(seen.has(resolve(root, "src/lib/inbox-writes.ts")), "the confirmed actions use the inbox write cores");
const senders = [...seen].map((f) => f.slice(root.length + 1).split(String.fromCharCode(92)).join("/")).filter((f) => /campaigns\/(send|audience|actions)|broadcast|drip-campaigns|contacts\/(csv|actions)/.test(f));
assert(senders.length === 0, `no campaign / broadcast / import module reachable: ${senders.join(", ")}`);
// The app's own auth never accepts a connector token.
for (const f of ["src/lib/current-member.ts", "src/lib/api-keys.ts"]) {
  const src = readFileSync(resolve(root, f), "utf8");
  assert(!/hcmcp/i.test(src) && !/mcp_tokens/.test(src), `${f} knows nothing of connector tokens`);
}
assert(!"hcmcp_x".startsWith("hc_"), "a connector token cannot pass the API-key prefix check");

console.log(`smoke-mcp: ok (${n} assertions, ${seen.size} files walked)`);

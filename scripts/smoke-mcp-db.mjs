// DB-backed smoke for the AI Connector, end to end through the REAL handlers
// (src/lib/mcp/*): client registration → authorize → Allow page → code → token
// (PKCE) → MCP initialize / tools → reads that follow the person's own
// visibility and modules → blocked paths → secret stripping → refresh rotation
// → disconnect / access removal → leak check (token revoked afterwards).
//
// Needs a throwaway Postgres it can create the `connect` schema in. It refuses
// any DATABASE_URL that is not on this machine, so it can never write to a real
// database. CI: the postgres service container.
//   DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable' node scripts/smoke-mcp-db.mjs

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

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  throw new Error("smoke-mcp-db only runs against a local throwaway Postgres (DATABASE_URL on localhost / 127.0.0.1).");
}
// An in-memory stand-in for the R2 FILES bucket (export_excel stores its files there).
const bucketStore = new Map();
const FILES = {
  async put(key, value, opts) {
    bucketStore.set(key, { bytes: new Uint8Array(value), customMetadata: opts?.customMetadata ?? {}, uploaded: new Date() });
  },
  async get(key) {
    const e = bucketStore.get(key);
    return e ? { body: new Blob([e.bytes]).stream(), customMetadata: e.customMetadata } : null;
  },
  async list({ prefix }) {
    return { objects: [...bucketStore.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, e]) => ({ key, uploaded: e.uploaded })) };
  },
  async delete(keys) {
    for (const k of [].concat(keys)) bucketStore.delete(k);
  },
};
globalThis[Symbol.for("__cloudflare-context__")] = { env: { DATABASE_URL: url, FILES } };

const { scriptDb } = await import("./_env.ts");
const { db, sql } = scriptDb();
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
await migrate(db, { migrationsFolder: resolve(root, "src/db/migrations"), migrationsSchema: "connect", migrationsTable: "__drizzle_migrations" });

const { getDb } = await import("../src/db/client.ts");
const appDb = getDb();
const { ensureAccessTables } = await import("../src/db/ensure-access.ts");
await ensureAccessTables(appDb);
const { ensureMcpTables } = await import("../src/db/ensure-mcp.ts");
await ensureMcpTables(appDb); // idempotent over the migration
const core = await import("../src/lib/mcp/core.ts");
const store = await import("../src/lib/mcp/store.ts");
const oauth = await import("../src/lib/mcp/oauth.ts");
const server = await import("../src/lib/mcp/server.ts");
const admin = await import("../src/lib/mcp/admin.ts");
const r3 = await import("../src/lib/mcp/round3.ts");
const { eq } = await import("drizzle-orm");
const schema = await import("../src/db/schema.ts");

// ── Seed: one company, two departments, an owner and two agents, two threads ──
const tag = `mcp${Date.now().toString(36)}`;
const id = (s) => `${tag}_${s}`;
await sql.unsafe(`insert into connect.company (id, name, slug) values ('${id("co")}', 'Smoke Co ${tag}', '${id("co")}')`);
await sql.unsafe(`insert into connect.department (id, company_id, name) values ('${id("d1")}', '${id("co")}', 'Delivery'), ('${id("d2")}', '${id("co")}', 'Service')`);
await sql.unsafe(`insert into connect.member (id, company_id, name, email, role, department_id) values
  ('${id("own")}', '${id("co")}', 'Owner', '${tag}-owner@example.com', 'SUPER_ADMIN', null),
  ('${id("a")}', '${id("co")}', 'Agent A', '${tag}-a@example.com', 'AGENT', '${id("d1")}'),
  ('${id("b")}', '${id("co")}', 'Agent B', '${tag}-b@example.com', 'AGENT', '${id("d2")}')`);
await sql.unsafe(`insert into connect.channel (id, company_id, display_name, phone) values ('${id("ch")}', '${id("co")}', 'Main', '+60100${Date.now() % 1000000}')`);
await sql.unsafe(`insert into connect.contact (id, company_id, name, phone, attributes) values
  ('${id("c1")}', '${id("co")}', 'Wong Ah Kow', '60111111111', '{"ref_1":"SO-${tag}","api_token":"SHOULD-NOT-LEAK"}'),
  ('${id("c2")}', '${id("co")}', 'Lim Mei', '60122222222', '{}')`);
await sql.unsafe(`insert into connect.conversation (id, channel_id, contact_id, assigned_department_id, last_message_at) values
  ('${id("v1")}', '${id("ch")}', '${id("c1")}', '${id("d1")}', now()),
  ('${id("v2")}', '${id("ch")}', '${id("c2")}', '${id("d2")}', now())`);
await sql.unsafe(`insert into connect.message (id, conversation_id, direction, body) values
  ('${id("m1")}', '${id("v1")}', 'IN', 'When is my sofa delivered?'),
  ('${id("m2")}', '${id("v2")}', 'IN', 'Private thread of department two')`);
await sql.unsafe(`insert into connect.payment (id, contact_id, amount, status) values ('${id("p1")}', '${id("c1")}', 1234.5, 'PENDING')`);

const findMember = (mid) => appDb.query.member.findFirst({ where: eq(schema.member.id, mid), with: { department: true } });
const agentA = await findMember(id("a"));
const owner = await findMember(id("own"));
const ORIGIN = "https://chat.smoke.test";
const req = (path, init = {}) => new Request(ORIGIN + path, init);

// ── 1. Dynamic client registration ──
let r = await oauth.handleRegister(appDb, req("/api/mcp/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: ["http://evil.example/cb"] }) }));
assert(r.status === 400, "registration refuses a non-loopback http redirect");
r = await oauth.handleRegister(appDb, req("/api/mcp/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) }));
assert(r.status === 201, "registration accepts https");
const client = await r.json();
assert(client.client_id.startsWith("mcpc_") && client.token_endpoint_auth_method === "none", "public client issued");

// ── 2. Authorize: validation, then the Allow page ──
const verifier = core.randomToken(48);
const challenge = await core.pkceS256(verifier);
const authUrl = (over = {}) => {
  const u = new URL(ORIGIN + "/api/mcp/oauth/authorize");
  const p = { client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "st-1", ...over };
  for (const [k, v] of Object.entries(p)) if (v !== null) u.searchParams.set(k, v);
  return u;
};
let s = await oauth.startAuthorize(appDb, authUrl({ redirect_uri: "https://claude.ai/other" }));
assert(s.kind === "error" && s.response.status === 400, "an unregistered redirect is refused without redirecting");
s = await oauth.startAuthorize(appDb, authUrl({ code_challenge_method: "plain" }));
assert(s.kind === "error" && s.response.status === 302 && s.response.headers.get("location").includes("error=invalid_request"), "no S256 → error back to the app");
s = await oauth.startAuthorize(appDb, authUrl({ client_id: "mcpc_unknown" }));
assert(s.kind === "error", "unknown client refused");

async function codeFor(member, approve = true) {
  const st = await oauth.startAuthorize(appDb, authUrl());
  assert(st.kind === "pending", "a valid authorize request is parked");
  const page = await (await oauth.consentPage(appDb, st.requestId, member, "Smoke Co")).text();
  const res = await oauth.decideConsent(appDb, st.requestId, approve, member);
  return { page, res, requestId: st.requestId };
}

// Agent A has no access yet: the page says so, and Allow is refused.
let c = await codeFor(agentA);
assert(c.page.includes("not turned on for your account"), "no access → the page says so");
assert(!c.res.headers.get("location"), "no access → no code");
await store.grantAccess(appDb, agentA.email, owner.id);
c = await codeFor(agentA);
assert(c.page.includes("Allow Claude to read Houzs Connect?") && c.page.includes("Read only"), "Allow page rendered");
const loc = new URL(c.res.headers.get("location"));
assert(c.res.status === 303 && loc.origin + loc.pathname === "https://claude.ai/api/mcp/auth_callback", "Allow returns to the registered redirect");
assert(loc.searchParams.get("state") === "st-1" && loc.searchParams.get("code"), "code + state returned");
const replay = await oauth.decideConsent(appDb, c.requestId, true, agentA);
assert(!replay.headers.get("location"), "a pending request is single use");
const cancel = await codeFor(agentA, false);
assert(new URL(cancel.res.headers.get("location")).searchParams.get("error") === "access_denied", "Cancel → access_denied");

// ── 3. Token endpoint ──
const tokenReq = (body) => req("/api/mcp/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
const bad = await codeFor(agentA);
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: new URL(bad.res.headers.get("location")).searchParams.get("code"), code_verifier: core.randomToken(48) }));
assert(r.status === 400 && (await r.json()).error === "invalid_grant", "wrong PKCE verifier refused");
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: loc.searchParams.get("code"), code_verifier: verifier, redirect_uri: client.redirect_uris[0] }));
assert(r.status === 200, "code + verifier → tokens");
let tok = await r.json();
assert(tok.access_token.startsWith("hcmcp_") && tok.refresh_token.startsWith("hcmcpr_") && tok.expires_in === 86400, "token shapes and 24 h access");
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: loc.searchParams.get("code"), code_verifier: verifier }));
assert(r.status === 400, "a code works once");
const stored = await sql.unsafe(`select access_hash, refresh_hash from connect.mcp_tokens where member_id = '${id("a")}'`);
assert(stored.every((t) => t.access_hash.length === 64 && !t.access_hash.startsWith("hcmcp")), "only SHA-256 hashes stored");

// ── 4. MCP endpoint ──
const rpc = async (token, body) => {
  const res = await server.handleMcpPost(appDb, req("/api/mcp", { method: "POST", headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {}, body: JSON.stringify(body) }), ORIGIN);
  return { status: res.status, headers: res.headers, body: res.status === 202 ? null : await res.json() };
};
// A reply may start with a one-line note (fields removed / cut) before the JSON.
const J = (t) => JSON.parse(t.content[0].text.replace(/^[^[{].*\n/, ""));
// The rate limit (30 tool calls a minute) is real here too: `call` first moves the call
// log two minutes back so this script's own burst never trips it. `callNow` does not —
// the rate-limit test below uses it.
const ageCalls = () => sql.unsafe("update connect.mcp_calls set created_at = created_at - interval '2 minutes'");
const callNow = async (token, name, args = {}) => (await rpc(token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).body.result;
const call = async (token, name, args = {}) => {
  await ageCalls();
  server.clearAnswerCache(); // round 4c P4: each step reads fresh; the cache has its own test below
  return callNow(token, name, args);
};

let x = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize" });
assert(x.status === 401 && x.headers.get("www-authenticate").includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`), "401 + WWW-Authenticate without a token");
x = await rpc("hcmcp_nonsense", { jsonrpc: "2.0", id: 1, method: "initialize" });
assert(x.status === 401 && x.headers.get("www-authenticate").includes('error="invalid_token"'), "unknown token → invalid_token");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
assert(x.body.result.protocolVersion === "2025-03-26" && x.body.result.serverInfo.name === "houzs-connect", "initialize negotiates the version");
assert(x.body.result.capabilities.prompts && x.body.result.instructions.includes("inbox_overview"), "initialize advertises prompts; instructions lead with the quick answers");
x = await rpc(tok.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
assert(x.status === 202, "a notification → 202");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert(
  x.body.result.tools.map((t) => t.name).join() ===
    "inbox_overview,waiting_now,service_performance,reply_speed,agent_workload,message_delivery,contacts_summary,campaign_summary,daily_brief,data_gaps,export_excel,search,fetch,whoami,list_modules,list_endpoints,connect_get",
  `quick answers, search / fetch, then the general tools (${x.body.result.tools.map((t) => t.name).join()})`
);
assert(x.body.result.tools.every((t) => t.annotations.readOnlyHint === true && !("module" in t)), "all tools read-only; no internal fields sent");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/list" });
assert(x.body.result.prompts.map((p) => p.name).join() === "daily-brief,inbox_today,service_review,find_customer,my_queue", `prompts/list for an agent: no supervisor prompts (${x.body.result.prompts.map((p) => p.name).join()})`);
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "find_customer", arguments: { who: "Wong" } } });
assert(x.body.result.messages[0].role === "user" && x.body.result.messages[0].content.text.includes('"Wong"'), "prompts/get expands a prompt");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "nope" } });
assert(x.body.error?.code === -32602, "unknown prompt → invalid params");
x = await rpc(tok.access_token, [{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", id: 4, method: "nope/nope" }]);
assert(Array.isArray(x.body) && x.body[1].error.code === -32601, "batch + method not found");

let t = await call(tok.access_token, "whoami");
assert(J(t).name === "Agent A", "whoami is the person");

// Own visibility: Agent A (Delivery) sees the Delivery thread, not Service's.
t = await call(tok.access_token, "connect_get", { path: "/conversations" });
let ids = J(t).conversations.map((v) => v.id);
assert(ids.includes(id("v1")) && !ids.includes(id("v2")), "conversation list follows the inbox rail's visibility");
t = await call(tok.access_token, "connect_get", { path: `/conversations/${id("v2")}` });
assert(t.isError && t.content[0].text.includes("not one this person can see"), "another department's thread is refused");
t = await call(tok.access_token, "connect_get", { path: `/conversations/${id("v1")}` });
const thread = J(t);
assert(thread.messages[0].text === "When is my sofa delivered?", "own thread readable");
assert(!t.content[0].text.includes("SHOULD-NOT-LEAK") && t.content[0].text.includes("Credential fields removed: api_token"), "credential-shaped field stripped");
t = await call(tok.access_token, "connect_get", { path: "/conversations", query: { q: `SO-${tag}` } });
assert(J(t).conversations.length === 1, "search by order number");

// Quick answers: one call, small, the person's own visibility.
t = await call(tok.access_token, "inbox_overview");
let ov1 = J(t);
assert(!t.isError && ov1.notClosed === 1 && ov1.waitingForUs === 1, `inbox overview counts only Agent A's visible thread (${t.content[0].text.slice(0, 200)})`);
assert(ov1.byChannel[0].name === "Main" && ov1.byAgent[0].name === "(unassigned)" && ov1.longestWaiting[0].id === id("v1"), "by channel / by person / longest waiting");
assert(ov1.today.messagesIn >= 1 && ov1.last7Days.contactsAdded >= 2, "today's messages and contacts added");
assert(t.content[0].text.length < 2000, `inbox overview is a few hundred characters (${t.content[0].text.length})`);
t = await call(tok.access_token, "service_performance", { days: 30 });
assert(!t.isError && J(t).period.includes("30 days") && J(t).replies.customersWhoWrote >= 1, `service performance (${t.content[0].text.slice(0, 160)})`);
// ── Round 3 quick answers, daily brief, export (Agent A: AGENT, every module on) ──
t = await call(tok.access_token, "reply_speed");
let rsp = J(t);
assert(!t.isError && rsp.slaMinutes > 0 && rsp.today.customersWhoWrote >= 1 && rsp.waitingOverSla.count === 0, `reply_speed (${t.content[0].text.slice(0, 200)})`);
await sql.unsafe(`insert into connect.message (id, conversation_id, direction, body, created_at) values ('${id("m0")}', '${id("v1")}', 'IN', 'Earlier message', now() - interval '2 hours')`);
await sql.unsafe(`update connect.message set created_at = now() - interval '45 minutes' where id = '${id("m1")}'`);
t = await call(tok.access_token, "reply_speed");
rsp = J(t);
assert(rsp.waitingOverSla.count >= 1 && rsp.waitingOverSla.longest.some((w) => w.conversationId === id("v1") && w.assignedTo === "(unassigned)" && w.department === "Delivery"), `waiting over SLA listed (${JSON.stringify(rsp.waitingOverSla)})`);
t = await call(tok.access_token, "message_delivery", { days: 3 });
assert(!t.isError && J(t).todayOutbound.sent === 0 && J(t).failed.days === 3, `message_delivery (${t.content[0].text.slice(0, 160)})`);
t = await call(tok.access_token, "contacts_summary");
assert(!t.isError && J(t).total >= 2 && J(t).added7d >= 2, `contacts_summary (${t.content[0].text.slice(0, 160)})`);
t = await call(tok.access_token, "campaign_summary");
assert(!t.isError && J(t).campaigns === 0, `campaign_summary (${t.content[0].text.slice(0, 160)})`);
t = await call(tok.access_token, "connect_get", { path: "/contacts/summary" });
assert(!t.isError && J(t).total >= 2, "/contacts/summary is the summary, not a contact id");

// The mood scan: an agent is refused with a plain line (and the refusal is logged).
t = await call(tok.access_token, "customer_mood_scan");
assert(t.isError && t.content[0].text.startsWith("Supervisors and admins only"), `mood scan refused for an agent (${t.content[0].text})`);
const moodLog = await sql.unsafe(`select status, ok from connect.mcp_calls where member_id = '${id("a")}' and tool = 'customer_mood_scan' order by created_at desc limit 1`);
assert(moodLog[0]?.status === 403 && moodLog[0]?.ok === false, "refused mood scan logged as 403");

// ── Round 4 as an AGENT (owner 2026-11-26: the connector follows Connect's RBAC exactly) ──
t = await call(tok.access_token, "waiting_now");
const wnow = J(t);
assert(
  !t.isError && wnow.waitingNow === 1 && wnow.longestFirst[0].conversationId === id("v1") && wnow.longestFirst[0].unansweredMessages === 2 && wnow.longestFirst[0].overSla && wnow.longestFirst[0].url === `${ORIGIN}/inbox/open/${id("v1")}`,
  `waiting_now: own inbox visibility, longest first, linked (${t.content[0].text.slice(0, 300)})`
);
assert(!t.content[0].text.includes(id("v2")), "waiting_now never shows another department's chat");
t = await call(tok.access_token, "agent_workload", { period: "week" });
const awl = J(t);
assert(!t.isError && awl.period === "week" && awl.unassignedNow.open === 2 && awl.team.customersWhoWrote >= 2, `agent_workload: the Dashboard's company-wide figures (${t.content[0].text.slice(0, 300)})`);
t = await call(tok.access_token, "agent_workload", { period: "fortnight" });
assert(t.isError && t.content[0].text.includes("period must be one of"), "agent_workload refuses an unknown period");
for (const name of ["chat_review", "customer_chat_summary"]) {
  t = await call(tok.access_token, name, name === "chat_review" ? { period: "week" } : { query: "Wong" });
  assert(t.isError && t.content[0].text.startsWith(`Supervisors and admins only: ${name}`), `${name}: an agent gets "no access" (${t.content[0].text})`);
  assert(!/sofa|Wong/.test(t.content[0].text), `${name}: no chat content in the refusal`);
  const lg = await sql.unsafe(`select status, ok from connect.mcp_calls where member_id = '${id("a")}' and tool = '${name}' order by created_at desc limit 1`);
  assert(lg[0]?.status === 403 && lg[0]?.ok === false, `refused ${name} logged as 403`);
}
t = await call(tok.access_token, "connect_get", { path: "/inbox/chat-review", query: { period: "week" } });
assert(t.isError && t.content[0].text.startsWith("Supervisors and admins only"), "the /inbox/chat-review endpoint holds the same gate through connect_get");
await sql.unsafe(`insert into connect.contact (id, company_id, name, phone) values ('${id("c3")}', '${id("co")}', null, '12345')`);
t = await call(tok.access_token, "data_gaps");
const dg = J(t);
assert(
  !t.isError && dg.contacts.noName.count === 1 && dg.contacts.phoneTooShort.examples[0].contactId === id("c3") && dg.conversations.noAgentAssigned === 1 && dg.conversations.examples[0].url === `${ORIGIN}/inbox/open/${id("v1")}`,
  `data_gaps: contacts + own unassigned chats (${t.content[0].text.slice(0, 400)})`
);
assert(!t.content[0].text.includes(id("v2")), "data_gaps never shows another department's chat");

t = await call(tok.access_token, "daily_brief");
const brief = J(t);
assert(!t.isError && typeof brief.inbox.waitingForUs === "number" && brief.paymentsToCheck.pending === 1 && "failedMessages" in brief, `daily_brief (${t.content[0].text.slice(0, 300)})`);
assert(brief.myConversations.assignedToMeNotClosed === 0, "nothing is assigned to Agent A yet");
await sql.unsafe(`update connect.conversation set assigned_agent_id = '${id("a")}' where id = '${id("v1")}'`);
t = await call(tok.access_token, "daily_brief");
assert(J(t).myConversations.waitingForMyReply === 1 && J(t).myConversations.top[0].url === `${ORIGIN}/inbox/open/${id("v1")}`, "daily_brief: my waiting conversation, with its link");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "daily-brief" } });
assert(x.body.result.messages[0].content.text.includes("daily_brief"), "daily-brief prompt");

t = await call(tok.access_token, "export_excel", { list: "conversations" });
let ex = J(t);
assert(!t.isError && ex.rows === 1 && ex.truncated === false && ex.linkValidMinutes === 15 && ex.download.startsWith(`${ORIGIN}/api/mcp/export/`), `export conversations, own visibility only (${t.content[0].text.slice(0, 200)})`);
assert(ex.columns.includes("Customer") && !ex.columns.some((c) => /message text/i.test(c)), "export columns");
const exRoute = await import("../src/app/api/mcp/export/[token]/route.ts");
const exToken = ex.download.split("/").pop();
let dl = await exRoute.GET(new Request(ex.download), { params: Promise.resolve({ token: exToken }) });
let dlBytes = Buffer.from(await dl.arrayBuffer());
assert(dl.status === 200 && dl.headers.get("content-type").includes("spreadsheetml") && dlBytes.subarray(0, 2).toString() === "PK", "the download link serves the .xlsx");
dl = await exRoute.GET(new Request(ORIGIN + "/api/mcp/export/x"), { params: Promise.resolve({ token: "A".repeat(32) }) });
assert(dl.status === 400, "an unknown link is refused");
for (const e of bucketStore.values()) e.customMetadata.expiresAt = new Date(Date.now() - 1000).toISOString();
dl = await exRoute.GET(new Request(ex.download), { params: Promise.resolve({ token: exToken }) });
assert(dl.status === 400 && (await dl.text()).includes("expired"), "an expired link is refused");
t = await call(tok.access_token, "export_excel", { list: "payments", filters: { status: "PENDING", bogus: "x" }, fields: ["customer", "amount"] });
ex = J(t);
assert(!t.isError && ex.rows === 1 && ex.columns.join() === "Customer,Amount (RM)", `export payments with filters + fields (${t.content[0].text.slice(0, 200)})`);
t = await call(tok.access_token, "export_excel", { list: "secrets" });
assert(t.isError && t.content[0].text.startsWith("Unknown list"), "export refuses a list outside the allowlist");


// search / fetch in the exact shape ChatGPT requires, inside the person's visibility.
t = await call(tok.access_token, "search", { query: "Wong" });
let sr = JSON.parse(t.content[0].text);
assert(Object.keys(sr).join() === "results" && sr.results.length >= 2, `search → {results} (${t.content[0].text.slice(0, 200)})`);
assert(sr.results.every((r) => Object.keys(r).join() === "id,title,url"), "each result is exactly {id, title, url}");
assert(sr.results.some((r) => r.id === `conversation:${id("v1")}` && r.url === `${ORIGIN}/inbox/open/${id("v1")}`), "own conversation found, with its link");
assert(sr.results.some((r) => r.id === `contact:${id("c1")}` && r.url === `${ORIGIN}/contacts?id=${id("c1")}`), "contact found, with its link");
t = await call(tok.access_token, "search", { query: "Private thread" });
assert(!JSON.parse(t.content[0].text).results.some((r) => r.id.startsWith("conversation:")), "search never returns another department's conversation");
t = await call(tok.access_token, "fetch", { id: `conversation:${id("v1")}` });
let doc = JSON.parse(t.content[0].text);
assert(Object.keys(doc).join() === "id,title,text,url,metadata", `fetch → {id, title, text, url, metadata} (${Object.keys(doc).join()})`);
assert(doc.text.includes("When is my sofa delivered?") && !doc.text.includes("SHOULD-NOT-LEAK") && doc.metadata.credentialFieldsRemoved.includes("api_token"), "fetch text, with credential fields stripped");
t = await call(tok.access_token, "fetch", { id: `conversation:${id("v2")}` });
assert(t.isError && t.content[0].text.includes("not one this person can see"), "fetch refuses another department's conversation");
t = await call(tok.access_token, "fetch", { id: `contact:${id("c1")}` });
doc = JSON.parse(t.content[0].text);
assert(doc.title.startsWith("Contact Wong") && doc.text.includes(`SO-${tag}`), "fetch a contact");
t = await call(tok.access_token, "fetch", { id: "payment:x" });
assert(t.isError, "fetch refuses an unknown kind");

// A batch of calls is logged — one row per call, written in one insert.
const before = (await sql.unsafe(`select count(*)::int as n from connect.mcp_calls where member_id = '${id("a")}'`))[0].n;
await rpc(tok.access_token, [
  { jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "whoami", arguments: {} } },
  { jsonrpc: "2.0", id: 32, method: "tools/call", params: { name: "search", arguments: { query: "Lim" } } },
]);
const after = (await sql.unsafe(`select count(*)::int as n from connect.mcp_calls where member_id = '${id("a")}'`))[0].n;
assert(after === before + 2, `a batch of two calls → two log rows (${before} → ${after})`);

// Blocked + unknown paths.
for (const p of ["/internal", "/settings/developers", "/api/v1/contacts", "/login"]) {
  t = await call(tok.access_token, "connect_get", { path: p });
  assert(t.isError && t.content[0].text.includes("not available through the AI connector"), `blocked ${p}`);
}
t = await call(tok.access_token, "connect_get", { path: "/nothing-here" });
assert(t.isError && t.content[0].text.includes("Unknown path"), "unknown path");

// Modules: an untick on Settings → Access takes the module away from the connector too.
t = await call(tok.access_token, "connect_get", { path: "/payments" });
assert(!t.isError && J(t).payments[0].amount === 1234.5, "payments readable while the module is on");
await sql.unsafe(`insert into connect.module_access (company_id, email, module, allowed) values ('${id("co")}', '${agentA.email}', 'payments', false)`);
t = await call(tok.access_token, "connect_get", { path: "/payments" });
assert(t.isError && t.content[0].text.startsWith("Not available to your role"), "module ticked off → refused");
t = await call(tok.access_token, "list_endpoints");
assert(!J(t).endpoints.some((e) => e.module === "payments"), "list_endpoints hides a module the person lacks");
for (const p of ["/contacts", "/tags", "/campaigns", "/automations", "/drip-campaigns", "/dashboard/summary", "/logs/messages", "/departments", `/contacts/${id("c1")}`]) {
  t = await call(tok.access_token, "connect_get", { path: p });
  assert(!t.isError, `readable: ${p} (${t.content[0].text.slice(0, 120)})`);
}

// The quick answers follow the modules too: dashboard ticked off → service_performance gone and refused.
await sql.unsafe(`insert into connect.module_access (company_id, email, module, allowed) values ('${id("co")}', '${agentA.email}', 'dashboard', false)`);
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert(!x.body.result.tools.some((tl) => tl.name === "service_performance") && x.body.result.tools.some((tl) => tl.name === "inbox_overview"), "a module ticked off hides its quick answer");
t = await call(tok.access_token, "service_performance");
assert(t.isError && t.content[0].text.startsWith("Not available to your role"), "and refuses it if called anyway");

// ── Round 4b write actions, end to end as Agent A (owner 2026-11-26) ──
// A separate chat (v5, Delivery — Agent A sees it) so the later chat_review /
// mood-scan figures are untouched; it is removed again at the end.
const actions = await import("../src/lib/mcp/actions.ts");
await sql.unsafe(`insert into connect.contact (id, company_id, name, phone, attributes) values ('${id("c5")}', '${id("co")}', 'Chan Write', '60155555555', '{"remarks":"Existing remark"}')`);
await sql.unsafe(`insert into connect.conversation (id, channel_id, contact_id, assigned_department_id, last_message_at) values ('${id("v5")}', '${id("ch")}', '${id("c5")}', '${id("d1")}', now())`);
const outCount = async (cv) => (await sql.unsafe(`select count(*)::int as n from connect.message where conversation_id = '${cv}' and direction = 'OUT'`))[0].n;
const pendingCount = async () => (await sql.unsafe(`select count(*)::int as n from connect.mcp_pending_actions where member_id = '${id("a")}'`))[0].n;
const listNames = async (token) => (await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools.map((tl) => tl.name);

// Off by default: nothing listed, a direct call refused, nothing stored.
assert(!(await listNames(tok.access_token)).some((nm) => nm.startsWith("propose_") || nm === "confirm_action"), "actions off by default → no write tool listed");
t = await call(tok.access_token, "propose_chat_reply", { conversationId: id("v5"), text: "Hello" });
assert(t.isError && t.content[0].text.startsWith("AI actions are switched off"), `switched off → refused (${t.content[0].text})`);
assert((await pendingCount()) === 0, "a refused proposal stores nothing");

// Main switch + the reply switch only.
await actions.setSwitch(appDb, "actions", true, owner.id);
await actions.setSwitch(appDb, "chat_reply", true, owner.id);
let wl = await listNames(tok.access_token);
assert(wl.includes("propose_chat_reply") && wl.includes("confirm_action") && !wl.includes("propose_conversation_assign") && !wl.includes("propose_contact_note"), `only switched-on actions are listed (${wl.filter((x) => x.startsWith("propose") || x.endsWith("_action")).join()})`);
t = await call(tok.access_token, "propose_conversation_assign", { conversationId: id("v5"), status: "resolved" });
assert(t.isError && t.content[0].text.includes("switched off"), "a switched-off action called directly is refused");

// Connect's own rules: the 24-hour window, and only chats this person can see.
t = await call(tok.access_token, "propose_chat_reply", { conversationId: id("v5"), text: "Hello" });
assert(t.isError && t.content[0].text.includes("24-hour reply window"), `window closed → refused (${t.content[0].text})`);
await sql.unsafe(`update connect.conversation set window_expires_at = now() + interval '3 hours' where id in ('${id("v5")}', '${id("v2")}')`);
t = await call(tok.access_token, "propose_chat_reply", { conversationId: id("v2"), text: "Not my chat" });
assert(t.isError && t.content[0].text.includes("not one this person can see"), `another department's chat → Connect's own refusal (${t.content[0].text})`);
assert((await pendingCount()) === 0 && (await outCount(id("v2"))) === 0, "nothing proposed, nothing sent on v2");

// Propose writes nothing; confirm writes once.
const beforeOut = await outCount(id("v5"));
t = await call(tok.access_token, "propose_chat_reply", { conversationId: id("v5"), text: "Your sofa arrives on Monday." });
const prop = J(t);
assert(!t.isError && /^mcpx_/.test(prop.confirmationId) && prop.summary.includes("Your sofa arrives on Monday.") && prop.summary.includes("Chan Write"), `proposal: exact text + the conversation (${t.content[0].text.slice(0, 300)})`);
assert((await outCount(id("v5"))) === beforeOut && (await pendingCount()) === 1, "a proposal writes nothing to Connect");
const ownerTry = await (await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: new URL((await codeFor(owner)).res.headers.get("location")).searchParams.get("code"), code_verifier: verifier }))).json();
t = await call(ownerTry.access_token, "confirm_action", { confirmationId: prop.confirmationId });
assert(t.isError && t.content[0].text.includes("not yours") && (await outCount(id("v5"))) === beforeOut, "another person cannot confirm it");
t = await call(tok.access_token, "confirm_action", { confirmationId: prop.confirmationId });
assert(!t.isError && t.content[0].text.startsWith("Reply sent"), `confirm sends (${t.content[0].text})`);
const sent = await sql.unsafe(`select body, sent_by_member_id, is_bot from connect.message where conversation_id = '${id("v5")}' and direction = 'OUT'`);
assert(sent.length === beforeOut + 1 && sent[0].body === "Your sofa arrives on Monday." && sent[0].sent_by_member_id === id("a") && sent[0].is_bot === false, "exactly one message, as Agent A, through the inbox's own send");
t = await call(tok.access_token, "confirm_action", { confirmationId: prop.confirmationId });
assert(t.isError && (await outCount(id("v5"))) === beforeOut + 1, "a confirmation is single use");
const act = await sql.unsafe(`select action, actor_member_id, detail from connect.activity_log where entity_id = '${id("v5")}' order by created_at desc limit 1`);
assert(act[0]?.action === "replied" && act[0].actor_member_id === id("a") && JSON.stringify(act[0].detail).includes("AI Connector"), "the reply is in Connect's activity log");
const logged = await sql.unsafe(`select tool, target, status from connect.mcp_calls where member_id = '${id("a")}' and tool in ('propose_chat_reply', 'confirm_action') order by created_at`);
assert(logged.some((lg) => lg.tool === "confirm_action" && lg.status === 200) && logged.every((lg) => !String(lg.target).includes("sofa")), "propose / confirm logged in mcp_calls, never with the message text");

// Switched off between proposal and confirm → refused, nothing sent, the confirmation not used up.
t = await call(tok.access_token, "propose_chat_reply", { conversationId: id("v5"), text: "Second message" });
const prop2 = J(t);
await actions.setSwitch(appDb, "chat_reply", false, owner.id);
t = await call(tok.access_token, "confirm_action", { confirmationId: prop2.confirmationId });
assert(t.isError && t.content[0].text.includes("switched off") && (await outCount(id("v5"))) === beforeOut + 1, "switched off → confirm refused, nothing sent");
t = await call(tok.access_token, "cancel_action", { confirmationId: prop2.confirmationId });
assert(!t.isError && t.content[0].text.startsWith("Cancelled"), "cancel_action");

// Assign / resolve and a contact note, through the inbox's own cores.
await actions.setSwitch(appDb, "conversation_assign", true, owner.id);
await actions.setSwitch(appDb, "contact_note", true, owner.id);
t = await call(tok.access_token, "propose_conversation_assign", { conversationId: id("v5"), assign_to: "Agent B", status: "resolved" });
assert(!t.isError && J(t).summary.includes("→ Agent B"), `assign proposal (${t.content[0].text.slice(0, 200)})`);
let cv5 = (await sql.unsafe(`select status, assigned_agent_id from connect.conversation where id = '${id("v5")}'`))[0];
assert(cv5.status === "OPEN" && cv5.assigned_agent_id === null, "the proposal changed nothing");
t = await call(tok.access_token, "confirm_action", { confirmationId: J(await call(tok.access_token, "propose_conversation_assign", { conversationId: id("v5"), assign_to: "Agent B", status: "resolved" })).confirmationId });
cv5 = (await sql.unsafe(`select status, assigned_agent_id from connect.conversation where id = '${id("v5")}'`))[0];
assert(!t.isError && cv5.status === "CLOSED" && cv5.assigned_agent_id === id("b"), `assigned + resolved (${t.content[0].text})`);
t = await call(tok.access_token, "propose_contact_note", { conversationId: id("v5"), note: "Prefers weekday mornings" });
t = await call(tok.access_token, "confirm_action", { confirmationId: J(t).confirmationId });
const rem = (await sql.unsafe(`select attributes from connect.contact where id = '${id("c5")}'`))[0].attributes;
assert(!t.isError && rem.remarks.startsWith("Existing remark\n[") && rem.remarks.endsWith("via AI Connector] Prefers weekday mornings"), `remarks appended (${JSON.stringify(rem)})`);

// Back to the default (all off) and remove the extra chat.
for (const k of ["actions", "chat_reply", "conversation_assign", "contact_note"]) await actions.setSwitch(appDb, k, false, owner.id);
await sql.unsafe(`delete from connect.message where conversation_id = '${id("v5")}'`);
await sql.unsafe(`delete from connect.conversation where id = '${id("v5")}'`);
await sql.unsafe(`delete from connect.contact where id = '${id("c5")}'`);
await sql.unsafe(`update connect.conversation set window_expires_at = null where id = '${id("v2")}'`);

// Round 4c P4: a heavy summary is reused for 60 s per person (logged as cached); callNow skips the cache reset.
server.clearAnswerCache();
await ageCalls();
await callNow(tok.access_token, "contacts_summary");
t = await callNow(tok.access_token, "contacts_summary");
const lastCs = await sql.unsafe(`select note, target from connect.mcp_calls where member_id = '${id("a")}' and tool = 'contacts_summary' order by created_at desc limit 1`);
assert(!t.isError && t.structuredContent?.link === `${ORIGIN}/contacts` && lastCs[0]?.note === "cached", `second call within 60 s served from the cache, with structuredContent + link (${JSON.stringify(lastCs[0])})`);

const calls = await sql.unsafe(`select count(*)::int as n, count(*) filter (where not ok)::int as refused from connect.mcp_calls where member_id = '${id("a")}'`);
assert(calls[0].n >= 20 && calls[0].refused >= 6, `every call logged (${calls[0].n}, ${calls[0].refused} refused)`);

// ── 5. Refresh rotation ──
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tok.refresh_token }));
assert(r.status === 200, "refresh works");
const tok2 = await r.json();
assert(tok2.refresh_token !== tok.refresh_token, "refresh token rotated");
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tok.refresh_token }));
assert(r.status === 400, "the old refresh token is dead");
assert((await rpc(tok.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status === 401, "the old access token is dead");
assert((await rpc(tok2.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status === 200, "the new access token works");

// ── 6. Admin: owner needs no approval; overview; leak check ──
const ownerCode = await codeFor(owner);
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: new URL(ownerCode.res.headers.get("location")).searchParams.get("code"), code_verifier: verifier }));
assert(r.status === 200, "Super Admin connects without an approval row");
const ownerTok = await r.json();

// The mood scan for a Super Admin: every conversation in the company, phones masked, flags set.
x = await rpc(ownerTok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert(x.body.result.tools.some((tl) => tl.name === "customer_mood_scan"), "mood scan listed to a Super Admin");
{
  const pr = await rpc(ownerTok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/list" });
  const pn = pr.body.result.prompts.map((p) => p.name);
  assert(pn.includes("supervisor_morning") && pn.includes("weekly_quality_review"), `supervisor prompts listed to a Super Admin (${pn.join()})`);
  const pg = await rpc(ownerTok.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "supervisor_morning" } });
  assert(pg.body.result.messages[0].content.text.includes("chat_review"), "supervisor_morning expands");
  const ag = await rpc(tok2.access_token, { jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "supervisor_morning" } });
  assert(ag.body.error?.code === -32602, "an agent cannot open a supervisor prompt");
}
// Yesterday + today, so a run just after midnight (Malaysia time) still covers the seeded messages.
t = await call(ownerTok.access_token, "customer_mood_scan", { from: r3.shiftDay(r3.myToday(), -1), to: r3.myToday() });
const mood = J(t);
assert(!t.isError && mood.conversations === 2 && mood.byConversation.length === 2, `mood scan sees the whole company (${t.content[0].text.slice(0, 300)})`);
const moodV1 = mood.byConversation.find((c) => c.conversationId === id("v1"));
assert(moodV1.customer === "Wong Ah Kow" && moodV1.flags.unansweredInARow === 2 && moodV1.flags.repeatedWithoutReply && moodV1.flags.overSla && moodV1.assignedTo === "Agent A", `mood flags (${JSON.stringify(moodV1.flags)})`);
assert(!t.content[0].text.includes("60111111111") && !t.content[0].text.includes("60122222222"), "no phone numbers in the mood scan");
t = await call(ownerTok.access_token, "customer_mood_scan", { from: "2026-01-01", to: "2026-01-31" });
assert(t.isError && t.content[0].text.includes("At most 7 days"), "mood scan range capped at 7 days");

// ── Round 4 as a Super Admin: chat review and one customer's chat ──
assert(x.body.result.tools.some((tl) => tl.name === "chat_review") && x.body.result.tools.some((tl) => tl.name === "customer_chat_summary"), "chat-content tools listed to a Super Admin");
await sql.unsafe(`insert into connect.message (id, conversation_id, direction, body, sent_by_member_id, is_bot) values
  ('${id("r1")}', '${id("v2")}', 'OUT', 'Your sofa arrives on Friday between 2 and 4pm', '${id("own")}', false)`);
await sql.unsafe(`insert into connect.message (id, conversation_id, direction, body, created_at) values
  ('${id("k1")}', '${id("v1")}', 'IN', 'Still waiting, this is so late', now() - interval '3 minutes'),
  ('${id("k2")}', '${id("v1")}', 'IN', 'I want a refund', now() - interval '2 minutes'),
  ('${id("k3")}', '${id("v1")}', 'IN', 'Very disappointed', now() - interval '1 minute')`);
const rng = { period: "custom", from: r3.shiftDay(r3.myToday(), -1), to: r3.myToday() };
t = await call(ownerTok.access_token, "chat_review", rng);
const rv = J(t);
assert(!t.isError && rv.quality.customersWhoWrote === 2 && rv.quality.replied === 1 && rv.quality.notReplied === 1, `chat_review partition (${t.content[0].text.slice(0, 400)})`);
const nr = rv.notReplied.longestFirst[0];
assert(nr.conversationId === id("v1") && nr.assignedTo === "Agent A" && nr.customerMessagesUnanswered === 5 && nr.waitingNow && nr.url === `${ORIGIN}/inbox/open/${id("v1")}`, `not replied: who, how many, linked (${JSON.stringify(nr)})`);
const rpl = rv.replied.latestFirst[0];
assert(rpl.conversationId === id("v2") && rpl.repliedBy === "Owner" && rpl.ourLastReply.startsWith("Your sofa arrives"), `replied, with what we replied (${JSON.stringify(rpl)})`);
assert(rv.repeatComplainers[0]?.customer === "Wong Ah Kow" && rv.repeatComplainers[0].complaintMessages >= 3 && rv.quality.negativeMood === 1, `repeat complainer (${JSON.stringify(rv.repeatComplainers)})`);
assert(rv.replyTimes?.team && Array.isArray(rv.replyTimes.byAgent), "reply times in the Dashboard's measurement");
assert(!t.content[0].text.includes("60111111111") && !t.content[0].text.includes("60122222222"), "no phone numbers in chat_review");
t = await call(ownerTok.access_token, "chat_review", { period: "custom", from: "2026-02-01", to: "2026-01-01" });
assert(t.isError && t.content[0].text.includes("from must be on or before to"), "chat_review refuses a reversed range");
t = await call(ownerTok.access_token, "customer_chat_summary", { query: "Wong" });
const cs = J(t);
assert(!t.isError && cs.conversationId === id("v1") && cs.customer === "Wong Ah Kow" && cs.orderRef === `SO-${tag}` && cs.flags.unansweredInARow === 5 && cs.flags.keywordHints.includes("refund"), `customer_chat_summary (${t.content[0].text.slice(0, 400)})`);
assert(!t.content[0].text.includes("60111111111") && !t.content[0].text.includes("SHOULD-NOT-LEAK"), "customer_chat_summary: no phone number, credential field stripped");
t = await call(ownerTok.access_token, "customer_chat_summary", { query: "60122222222" });
assert(!t.isError && J(t).conversationId === id("v2") && J(t).messages.some((m) => m.text.startsWith("Your sofa arrives")), "found by phone, with our reply");
t = await call(ownerTok.access_token, "customer_chat_summary", { query: "nobody-like-this" });
assert(!t.isError && J(t).found === false, "no match says so");
t = await call(ownerTok.access_token, "customer_chat_summary", {});
assert(t.isError && t.content[0].text.startsWith("Give a customer"), "customer_chat_summary needs a query");

// Rate limit: counted per person from mcp_calls; over it → a normal isError result, logged as 429, not counted.
await ageCalls();
const ownerEmail = owner.email.toLowerCase();
const fill = (n, ago) =>
  sql.unsafe(`insert into connect.mcp_calls (id, member_id, email, tool, ok, status, created_at)
    select '${tag}_rl_' || g || '_${ago}', '${owner.id}', '${ownerEmail}', 'synthetic', true, 200, now() - interval '${ago}'
    from generate_series(1, ${n}) g`);
await fill(r3.RATE_LIMITS.perMinute - 1, "5 seconds");
assert(!(await callNow(ownerTok.access_token, "whoami")).isError, "call number 30 in a minute is allowed");
t = await callNow(ownerTok.access_token, "whoami");
assert(t.isError && t.content[0].text.startsWith("Too many requests — wait a minute"), `call 31 → plain refusal (${t.content[0].text})`);
x = await rpc(ownerTok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert(Array.isArray(x.body.result.tools), "tools/list is not counted or refused");
const limited = await sql.unsafe(`select count(*)::int as n from connect.mcp_calls where email = '${ownerEmail}' and status = 429`);
assert(limited[0].n === 1 && (await store.countRecentCalls(appDb, owner.email)).minute === r3.RATE_LIMITS.perMinute, "refusal logged as 429 and not counted");
// A batch counts its own earlier calls: they are not in mcp_calls until after the answer.
await ageCalls();
await fill(r3.RATE_LIMITS.perMinute - 2, "5 seconds");
const wb = (i) => ({ jsonrpc: "2.0", id: 40 + i, method: "tools/call", params: { name: "whoami", arguments: {} } });
x = await rpc(ownerTok.access_token, [wb(0), wb(1), wb(2)]);
assert(!x.body[0].result.isError && !x.body[1].result.isError && x.body[2].result.content[0].text.startsWith("Too many requests"), "third call in a batch at the limit is refused");
x = await rpc(ownerTok.access_token, Array.from({ length: server.MAX_BATCH + 1 }, (_, i) => wb(i)));
assert(x.status === 400 && x.body.error.code === -32600, `a batch over ${server.MAX_BATCH} is refused`);
await ageCalls();
assert(!(await callNow(ownerTok.access_token, "whoami")).isError, "a minute later it works again");
await fill(r3.RATE_LIMITS.perDay, "1 hour");
t = await callNow(ownerTok.access_token, "whoami");
assert(t.isError && t.content[0].text.startsWith("Daily limit reached"), `daily limit (${t.content[0].text})`);
await sql.unsafe(`delete from connect.mcp_calls where tool = 'synthetic' and email = '${ownerEmail}'`);
const ov = await admin.adminOverview(appDb);
assert(ov.connected.some((k) => k.email === agentA.email) && ov.allowed.some((a) => a.email === agentA.email), "overview lists the connection and the allowed person");
assert(ov.calls.length > 0 && ov.calls.length <= 100, "recent lookups listed");
assert(ov.staff.some((p) => p.email === `${tag}-b@example.com`) && !ov.staff.some((p) => p.email === agentA.email), "turn-on list = not yet allowed");

const lc0 = await admin.runLeakCheck(appDb, owner.email, id("co"));
assert("error" in lc0 && lc0.error.includes("Admins"), "leak check refuses an admin account");
const lc1 = await admin.runLeakCheck(appDb, `${tag}-b@example.com`, id("co"));
assert("error" in lc1 && lc1.error.includes("Turn on"), "leak check needs the person approved");
await store.requestAccess(appDb, { id: id("b"), email: `${tag}-b@example.com`, companyId: id("co"), name: "Agent B" }, "for reports");
assert((await store.requestAccess(appDb, { id: id("b"), email: `${tag}-b@example.com`, companyId: id("co"), name: "Agent B" }, "")) === "already", "one pending request per person");
const reqRow = (await admin.adminOverview(appDb)).requests.find((q) => q.email === `${tag}-b@example.com`);
assert(reqRow && (await store.decideRequest(appDb, reqRow.id, true, owner.id)) === `${tag}-b@example.com`, "approve a request");
const lc = await admin.runLeakCheck(appDb, `${tag}-b@example.com`, id("co"));
assert(!("error" in lc) && lc.rows.length >= 10, "leak check ran over the list endpoints");
const pay = lc.rows.find((row) => row.path === "/payments");
assert(pay.outcome === "opened" && pay.sensitive.includes("amount") && pay.sensitive.includes("phone"), "leak check names money / people fields");
assert(!JSON.stringify(lc).includes("1234.5") && !JSON.stringify(lc).includes("60111111111"), "leak check reports names, never values");
const chatRow = lc.rows.find((row) => row.path === "/inbox/chat-review");
assert(chatRow?.outcome === "refused" && chatRow.status === 403, `leak check: chat review refused for an agent (${JSON.stringify(chatRow)})`);
for (const pth of ["/inbox/waiting", "/dashboard/agents", "/contacts/gaps"]) assert(lc.rows.find((row) => row.path === pth)?.outcome === "opened", `leak check reads ${pth} as the agent`);
const live = await sql.unsafe(`select count(*)::int as n from connect.mcp_tokens where client_id = '${core.LEAK_CLIENT_ID}' and revoked_at is null`);
assert(live[0].n === 0, "the leak-check token is revoked afterwards");

// ── 7. Disconnect + access removal ──
const mine = await admin.myConnector(appDb, agentA);
assert(mine.allowed && mine.apps.length >= 1, "my connected apps listed");
assert((await store.removeAccess(appDb, agentA.email)) >= 1, "remove access cuts connections");
assert((await rpc(tok2.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status === 401, "a removed person's token stops at once");
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tok2.refresh_token }));
assert(r.status === 400, "and cannot be refreshed");

// Team page "remove access" (access_removed) also stops the connector, even for an approved person.
const bCode = await codeFor(await findMember(id("b")));
r = await oauth.handleToken(appDb, tokenReq({ grant_type: "authorization_code", client_id: client.client_id, code: new URL(bCode.res.headers.get("location")).searchParams.get("code"), code_verifier: verifier }));
const tokB = await r.json();
assert((await rpc(tokB.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status === 200, "approved person B connected");
await sql.unsafe(`insert into connect.access_removed (email) values ('${tag}-b@example.com')`);
assert((await rpc(tokB.access_token, { jsonrpc: "2.0", id: 1, method: "ping" })).status === 401, "Connect access removed → connector stops");

await sql.end();
console.log(`smoke-mcp-db: ok (${n} assertions)`);
process.exit(0);

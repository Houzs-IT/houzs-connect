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
globalThis[Symbol.for("__cloudflare-context__")] = { env: { DATABASE_URL: url } };

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
const call = async (token, name, args = {}) => (await rpc(token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } })).body.result;

let x = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize" });
assert(x.status === 401 && x.headers.get("www-authenticate").includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`), "401 + WWW-Authenticate without a token");
x = await rpc("hcmcp_nonsense", { jsonrpc: "2.0", id: 1, method: "initialize" });
assert(x.status === 401 && x.headers.get("www-authenticate").includes('error="invalid_token"'), "unknown token → invalid_token");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
assert(x.body.result.protocolVersion === "2025-03-26" && x.body.result.serverInfo.name === "houzs-connect", "initialize negotiates the version");
x = await rpc(tok.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
assert(x.status === 202, "a notification → 202");
x = await rpc(tok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
assert(x.body.result.tools.map((t) => t.name).join() === "whoami,list_modules,list_endpoints,connect_get", "four tools");
assert(x.body.result.tools.every((t) => t.annotations.readOnlyHint === true), "all tools read-only");
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

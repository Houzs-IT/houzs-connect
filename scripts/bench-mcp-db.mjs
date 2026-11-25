// AI Connector bench: reply size, DB queries and local time per MCP call, through
// the REAL handler (server.handleMcpPost), on a seeded throwaway Postgres.
//
// Not a CI gate — a measuring tool for before/after comparisons. DB queries are
// counted on the wire: the app's connection goes through a tiny TCP proxy that
// counts every query the client sends (a Sync / simple Query message), so a query
// made by a helper that calls getDb() itself is counted too.
//
// Refuses any DATABASE_URL that is not on this machine. Times are local (PGlite
// or a local Postgres) and say nothing about Hyperdrive → Supabase latency; the
// query COUNT is what carries over (each one is a round trip in production).
//   DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55433/postgres?sslmode=disable' node scripts/bench-mcp-db.mjs

import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = process.env.DATABASE_URL ?? "";
const m = /^postgres(?:ql)?:\/\/([^@]+)@(localhost|127\.0\.0\.1):(\d+)\/(.*)$/.exec(upstream);
if (!m) throw new Error("bench-mcp-db only runs against a local throwaway Postgres (DATABASE_URL on localhost / 127.0.0.1).");

// ── query-counting proxy ──
let queries = 0;
const proxy = net.createServer((client) => {
  const up = net.connect(Number(m[3]), m[2]);
  let buf = Buffer.alloc(0);
  let started = false;
  client.on("data", (chunk) => {
    up.write(chunk);
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!started) {
        if (buf.length < 4) break;
        const len = buf.readInt32BE(0);
        if (buf.length < len) break;
        buf = buf.subarray(len);
        started = true;
        continue;
      }
      if (buf.length < 5) break;
      const type = String.fromCharCode(buf[0]);
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) break;
      if (type === "S" || type === "Q") queries++;
      buf = buf.subarray(1 + len);
    }
  });
  up.on("data", (d) => client.write(d));
  const end = () => {
    client.destroy();
    up.destroy();
  };
  client.on("error", end);
  up.on("error", end);
  client.on("close", end);
  up.on("close", end);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const viaProxy = `postgres://${m[1]}@127.0.0.1:${proxy.address().port}/${m[4]}`;
globalThis[Symbol.for("__cloudflare-context__")] = { env: { DATABASE_URL: viaProxy } };

const { scriptDb } = await import("./_env.ts");
const { db, sql } = scriptDb();
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
await migrate(db, { migrationsFolder: resolve(root, "src/db/migrations"), migrationsSchema: "connect", migrationsTable: "__drizzle_migrations" });

const { getDb } = await import("../src/db/client.ts");
const appDb = getDb();
await (await import("../src/db/ensure-access.ts")).ensureAccessTables(appDb);
await (await import("../src/db/ensure-mcp.ts")).ensureMcpTables(appDb);
const store = await import("../src/lib/mcp/store.ts");
const server = await import("../src/lib/mcp/server.ts");

// ── seed: a company the size of a busy month ──
const tag = `bn${Date.now().toString(36)}`;
const id = (s) => `${tag}_${s}`;
const N_CONTACTS = 300;
const N_CONVOS = 400;
const MSGS_PER = 10;
await sql.unsafe(`insert into connect.company (id, name, slug) values ('${id("co")}', 'Bench Co ${tag}', '${id("co")}')`);
await sql.unsafe(`insert into connect.department (id, company_id, name) values ('${id("d1")}', '${id("co")}', 'Delivery'), ('${id("d2")}', '${id("co")}', 'Service'), ('${id("d3")}', '${id("co")}', 'Sales')`);
const agents = [1, 2, 3, 4, 5].map((i) => id(`a${i}`));
await sql.unsafe(`insert into connect.member (id, company_id, name, email, role, department_id) values
  ('${id("own")}', '${id("co")}', 'Owner', '${tag}-owner@example.com', 'SUPER_ADMIN', null),
  ${agents.map((a, i) => `('${a}', '${id("co")}', 'Agent ${i + 1}', '${tag}-a${i + 1}@example.com', 'AGENT', '${id(`d${(i % 3) + 1}`)}')`).join(",")}`);
await sql.unsafe(`insert into connect.channel (id, company_id, display_name, phone) values
  ('${id("ch1")}', '${id("co")}', 'Delivery line', '+601${Date.now() % 10000000}'),
  ('${id("ch2")}', '${id("co")}', 'Service line', '+602${Date.now() % 10000000}')`);
const attrs = (i) =>
  JSON.stringify({
    ref_1: `SO-${tag}-${i}`,
    delivery_date_1: "2026-12-01",
    address: `${i} Jalan Bench, Taman Ujian, 43000 Kajang, Selangor`,
    product_1: "Sofa 3-seater, fabric grey, with ottoman and two cushions",
    balance_due: String(1000 + i),
    sales_person: "Agent 1",
    note: "Customer prefers afternoon delivery; call before arriving. Lift available.",
    city: "Kajang",
    state: "Selangor",
    source_branch: "Showroom A",
  });
const contacts = [];
for (let i = 0; i < N_CONTACTS; i++) contacts.push(`('${id(`c${i}`)}', '${id("co")}', 'Customer ${i} Wong', '6011${String(1000000 + i)}', '${attrs(i)}')`);
await sql.unsafe(`insert into connect.contact (id, company_id, name, phone, attributes) values ${contacts.join(",")}`);
const statuses = ["OPEN", "OPEN", "PENDING", "QUEUE", "CLOSED"];
const convos = [];
for (let i = 0; i < N_CONVOS; i++) {
  const agent = i % 4 === 0 ? "null" : `'${agents[i % agents.length]}'`;
  convos.push(
    `('${id(`v${i}`)}', '${id(i % 2 ? "ch1" : "ch2")}', '${id(`c${i % N_CONTACTS}`)}', '${statuses[i % statuses.length]}', ${agent}, '${id(`d${(i % 3) + 1}`)}', now() - interval '${i * 37} minutes', ${i % 3}, now() - interval '${i * 2} hours')`
  );
}
await sql.unsafe(`insert into connect.conversation (id, channel_id, contact_id, status, assigned_agent_id, assigned_department_id, last_message_at, unread_count, created_at) values ${convos.join(",")}`);
const msgs = [];
for (let i = 0; i < N_CONVOS; i++) {
  for (let k = 0; k < MSGS_PER; k++) {
    const dir = (k + (i % 2)) % 2 === 0 ? "IN" : "OUT";
    const by = dir === "OUT" ? `'${agents[(i + k) % agents.length]}'` : "null";
    msgs.push(
      `('${id(`m${i}_${k}`)}', '${id(`v${i}`)}', '${dir}', 'Message ${k} about the delivery of order SO-${tag}-${i % N_CONTACTS}: when will the sofa arrive, and can the driver call first?', ${by}, now() - interval '${i * 37 + (MSGS_PER - k) * 3} minutes')`
    );
  }
}
for (let i = 0; i < msgs.length; i += 1000) {
  await sql.unsafe(`insert into connect.message (id, conversation_id, direction, body, sent_by_member_id, created_at) values ${msgs.slice(i, i + 1000).join(",")}`);
}
const pays = [];
for (let i = 0; i < 50; i++) pays.push(`('${id(`p${i}`)}', '${id(`c${i}`)}', ${100 + i}, '${["PENDING", "VERIFIED", "REJECTED"][i % 3]}')`);
await sql.unsafe(`insert into connect.payment (id, contact_id, amount, status) values ${pays.join(",")}`);

const findMember = (mid) => appDb.query.member.findFirst({ where: (t, { eq }) => eq(t.id, mid), with: { department: true } });
const owner = await findMember(id("own"));
const agent = await findMember(agents[0]);
await store.grantAccess(appDb, agent.email, owner.id);
const ownerTok = (await store.issueTokens(appDb, owner, "mcpc_bench")).accessToken;
const agentTok = (await store.issueTokens(appDb, agent, "mcpc_bench")).accessToken;

const ORIGIN = "https://chat.bench.test";
async function rpc(token, body) {
  const q0 = queries;
  const t0 = performance.now();
  const res = await server.handleMcpPost(appDb, new Request(ORIGIN + "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), ORIGIN, (p) => void p);
  const txt = res.status === 202 ? "" : await res.text();
  const ms = performance.now() - t0;
  const qAnswer = queries - q0;
  // Let any deferred bookkeeping (call log) land before the next count.
  await new Promise((r) => setTimeout(r, 30));
  return { ms, qAnswer, q: queries - q0, txt, status: res.status };
}
const tools = JSON.parse((await rpc(ownerTok, { jsonrpc: "2.0", id: 1, method: "tools/list" })).txt).result.tools.map((t) => t.name);

const cases = [
  ["initialize", { method: "initialize", params: { protocolVersion: "2025-06-18" } }],
  ["tools/list", { method: "tools/list" }],
  ["whoami", { method: "tools/call", params: { name: "whoami", arguments: {} } }],
  ["list_modules", { method: "tools/call", params: { name: "list_modules", arguments: {} } }],
  ["list_endpoints", { method: "tools/call", params: { name: "list_endpoints", arguments: {} } }],
  ...["/conversations", `/conversations/${id("v3")}`, "/contacts", `/contacts/${id("c1")}`, "/payments", "/dashboard/summary", "/logs/messages", "/tags"].map((p) => [
    `connect_get ${p.replace(tag + "_", "")}`,
    { method: "tools/call", params: { name: "connect_get", arguments: { path: p } } },
  ]),
  ["connect_get /conversations limit=100", { method: "tools/call", params: { name: "connect_get", arguments: { path: "/conversations", query: { limit: 100 } } } }],
  ["connect_get /conversations q=Wong", { method: "tools/call", params: { name: "connect_get", arguments: { path: "/conversations", query: { q: "Customer 12" } } } }],
  ["connect_get /contacts q=Wong", { method: "tools/call", params: { name: "connect_get", arguments: { path: "/contacts", query: { q: "Customer 12" } } } }],
];
if (tools.includes("inbox_overview")) cases.push(["inbox_overview", { method: "tools/call", params: { name: "inbox_overview", arguments: {} } }]);
if (tools.includes("service_performance")) cases.push(["service_performance", { method: "tools/call", params: { name: "service_performance", arguments: {} } }]);
if (tools.includes("search")) cases.push(["search 'Customer 12'", { method: "tools/call", params: { name: "search", arguments: { query: "Customer 12" } } }]);
if (tools.includes("fetch")) {
  cases.push(["fetch conversation", { method: "tools/call", params: { name: "fetch", arguments: { id: `conversation:${id("v3")}` } } }]);
  cases.push(["fetch contact", { method: "tools/call", params: { name: "fetch", arguments: { id: `contact:${id("c1")}` } } }]);
}

const fmt = (r) => `${String(r.txt.length).padStart(7)} chars  ${String(r.qAnswer).padStart(3)} queries before the answer (${r.q} total)  ${r.ms.toFixed(0).padStart(5)} ms`;
for (const [who, tok] of [["owner (SUPER_ADMIN)", ownerTok], ["agent (AGENT, approved)", agentTok]]) {
  console.log(`\n== ${who} — ${N_CONTACTS} contacts, ${N_CONVOS} conversations, ${N_CONVOS * MSGS_PER} messages`);
  // Warm the isolate-level ensure* memos first, as a running Worker would have them.
  await rpc(tok, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "connect_get", arguments: { path: "/conversations" } } });
  for (const [label, body] of cases) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await rpc(tok, { jsonrpc: "2.0", id: 2, ...body }));
    runs.sort((a, b) => a.ms - b.ms);
    const r = runs[1];
    console.log(`${label.padEnd(42)} ${fmt(r)}${r.status !== 200 || r.txt.includes('"isError":true') ? "  (error)" : ""}`);
  }
}

await sql.end();
proxy.close();
process.exit(0);

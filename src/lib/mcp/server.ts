// POST /api/mcp — the AI Connector (MCP Streamable HTTP, stateless JSON-RPC).
//
// READ-ONLY and OWN-PERMISSIONS, by construction:
//
// 1. The connector token (hcmcp_…) is accepted in exactly one place: this
//    handler. Every page, route handler and server action of the app
//    authenticates with the hc_session cookie (lib/current-member.ts) or an
//    hc_ API key (lib/api-keys.ts); neither ever looks at an hcmcp_ token, so a
//    leaked connector token cannot open a page, call /api/v1, or invoke a server
//    action. Nothing new was added to the app's own auth.
// 2. A tool call does not re-enter the app at all. It runs one function from a
//    fixed catalogue (lib/mcp/reads.ts), each of which is SELECT-only and imports
//    no "use server" module (pinned by scripts/smoke-mcp.mjs). The only writes on
//    this path are the connector's own bookkeeping (mcp_calls, last_used_at).
// 3. Each call runs as the real person: their member row is re-read on every
//    request (inactive, access removed on the Team page, or AI Connector access
//    taken away → 401), their modules come from the same Settings → Access
//    rules requireModule() uses, and conversations go through the inbox rail's
//    own company + org-chart visibility predicate.
// 4. Credential-shaped fields are stripped from every reply; replies are capped.

import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { member } from "@/db/schema";
import { bypassReadCache } from "@/db/fresh";
import { moduleChoices } from "@/lib/full-access";
import { resolveModules, type Module } from "@/lib/module-access";
import { isAccessRemoved } from "@/lib/team-access";
import { CORS_HEADERS, capText, classifyPath, MCP_PROTOCOL_VERSIONS, MCP_BLOCKED_PREFIXES, redactSecrets } from "./core";
import { ENDPOINTS, ReadError, companyName, findEndpoint, moduleCatalog, type McpMember, type ReadCtx } from "./reads";
import { hasMcpAccess, logCall, mcpDb, resolveAccessToken } from "./store";

export const SERVER_INFO = { name: "houzs-connect", title: "Houzs Connect", version: "1.0.0" };

export type Identity = { tokenId: string; clientId: string; me: McpMember; modules: Module[] };
type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to Houzs Connect — the company's WhatsApp customer-service and follow-up platform (Service inbox, customers/contacts, payment slips, campaigns, automations, dashboard, message logs) — as the signed-in staff member.
Everything is READ-ONLY and limited to what this person can see in Houzs Connect. Never guess figures a call did not return.
Start with list_modules, then list_endpoints, then connect_get with a path such as /conversations or /contacts. Use query parameters (q, status, limit, days) to keep answers small.
If a call says "Not available to your role", tell the person they do not have access to that part of Houzs Connect.`;

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const TOOLS = [
  { name: "whoami", title: "Who am I connected as", description: "The Houzs Connect account this connection uses: name, company, role and which modules it can read.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: RO },
  { name: "list_modules", title: "List modules", description: "The Houzs Connect modules this person can read, with how many read endpoints each has. Start here.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: RO },
  {
    name: "list_endpoints",
    title: "List read endpoints",
    description: "The read endpoints (paths, what they return, query parameters). Optionally only one module.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: "Module name from list_modules, e.g. inbox" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "connect_get",
    title: "Read from Houzs Connect",
    description: "Read one endpoint as the signed-in person and return its JSON. Large replies are cut; narrow them with query parameters.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint path with real ids in place of :id, e.g. /conversations or /contacts/abc123" },
        query: { type: "object", description: 'Query parameters, e.g. {"q":"wong","limit":10}', additionalProperties: { type: ["string", "number", "boolean"] } },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: RO,
  },
];

/** The person behind a connector token, or null (unknown / expired / revoked / inactive / access removed). */
export async function mcpIdentity(db: DB, token: string): Promise<Identity | null> {
  await mcpDb(db);
  const row = await resolveAccessToken(db, token);
  if (!row) return null;
  // Fresh (db/fresh.ts): a person switched off a moment ago must not get one more answer.
  const me = await db.query.member.findFirst({ where: and(eq(member.id, row.memberId), bypassReadCache()), with: { department: true } });
  if (!me || !me.active) return null;
  if (await isAccessRemoved(db, me.email)) return null;
  if (!(await hasMcpAccess(db, me.email, me.role))) return null;
  const modules = resolveModules(me.role, await moduleChoices(me.companyId, me.email));
  return { tokenId: row.tokenId, clientId: row.clientId, me, modules };
}

export type ReadOutcome = { result: ToolResult; status: number; note: string; target: string; body: unknown; removed: string[] };

/** Read one catalogue endpoint as the person; shared with the leak check. */
export async function readEndpoint(db: DB, id: Identity, rawPath: unknown, query: unknown): Promise<ReadOutcome> {
  const d = classifyPath(rawPath);
  if (!d.ok) return { result: text(d.reason, true), status: 400, note: "blocked path", target: String(rawPath ?? "").slice(0, 200), body: null, removed: [] };
  const q: Record<string, unknown> = {};
  if (query && typeof query === "object" && !Array.isArray(query)) {
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (v === undefined || v === null || typeof v === "object") continue;
      q[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 200) : v;
    }
  }
  const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
  const target = d.path + (qs ? `?${qs}` : "");
  const found = findEndpoint(d.path);
  if (!found) {
    return { result: text("Unknown path — call list_endpoints to see what can be read.", true), status: 404, note: "unknown path", target, body: null, removed: [] };
  }
  if (!id.modules.includes(found.ep.module)) {
    return {
      result: text(`Not available to your role: "${found.ep.module}" is not turned on for this account in Houzs Connect.`, true),
      status: 403,
      note: "no permission",
      target,
      body: null,
      removed: [],
    };
  }
  let body: unknown;
  try {
    const ctx: ReadCtx = { db, me: id.me, modules: id.modules };
    body = await found.ep.run(ctx, found.params, q);
  } catch (e) {
    if (e instanceof ReadError) return { result: text(e.message, true), status: e.status, note: e.message.slice(0, 120), target, body: null, removed: [] };
    console.error("[mcp] read failed:", target, e);
    return { result: text("Houzs Connect could not read that just now. Try again, or narrow the query.", true), status: 500, note: "read failed", target, body: null, removed: [] };
  }
  const { value, removed } = redactSecrets(body);
  const notes = removed.size ? [`Credential fields removed: ${[...removed].join(", ")}.`] : [];
  return { result: text(capText(JSON.stringify(value), notes).text), status: 200, note: "", target, body: value, removed: [...removed] };
}

async function callTool(db: DB, id: Identity, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200;
  let note = "";
  let target = "";
  let result: ToolResult;
  try {
    if (name === "whoami") {
      const m = id.me;
      result = text(
        JSON.stringify({
          name: m.name,
          email: m.email,
          company: await companyName(db, m.companyId),
          role: m.role,
          title: m.title,
          department: m.department?.name ?? null,
          modules: id.modules,
          readOnly: true,
        })
      );
    } else if (name === "list_modules") {
      result = text(
        JSON.stringify({
          readOnly: true,
          modules: moduleCatalog(id.modules),
          neverAvailable: MCP_BLOCKED_PREFIXES.slice(0, 4),
          tip: "Call list_endpoints (optionally with a module), then connect_get.",
        })
      );
    } else if (name === "list_endpoints") {
      const mod = typeof args.module === "string" ? args.module.trim() : "";
      target = mod;
      const eps = ENDPOINTS.filter((e) => id.modules.includes(e.module) && (!mod || e.module === mod)).map((e) => ({
        path: e.path,
        module: e.module,
        description: e.description,
        query: e.params ?? {},
      }));
      result = text(JSON.stringify({ endpoints: eps }));
    } else if (name === "connect_get") {
      const r = await readEndpoint(db, id, args.path, args.query);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else {
      result = text(`Unknown tool: ${name}`, true);
      status = 400;
    }
  } catch (e) {
    console.error("[mcp] tool failed:", name, e);
    result = text("The tool failed. Try again.", true);
    status = 500;
  }
  await logCall(db, {
    tokenId: id.tokenId,
    memberId: id.me.id,
    email: id.me.email,
    companyId: id.me.companyId,
    clientId: id.clientId,
    tool: name,
    target,
    status,
    ok: !result.isError,
    note,
    ms: Date.now() - t0,
  });
  return result;
}

export async function handleRpc(db: DB, id: Identity, m: RpcReq): Promise<unknown> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  if (!m || typeof m !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      return reply(await callTool(db, id, String(m.params?.name ?? ""), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      if (m.id === undefined || m.id === null || (m.method ?? "").startsWith("notifications/")) return null;
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ""}` } };
  }
}

export { CORS_HEADERS };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS, ...extra } });

/** The whole POST /api/mcp exchange. `origin` is the public address (core.originFor). */
export async function handleMcpPost(db: DB, req: Request, origin: string): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const id = token ? await mcpIdentity(db, token) : null;
  if (!id) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
      "WWW-Authenticate": `Bearer realm="houzs-connect", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"${token ? ', error="invalid_token"' : ""}`,
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const msgs = Array.isArray(body) ? (body as RpcReq[]) : [body as RpcReq];
  if (msgs.length > 20) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Too many messages in one batch" } }, 400);
  const out: unknown[] = [];
  for (const m of msgs) {
    const r = await handleRpc(db, id, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(Array.isArray(body) ? out : out[0]);
}

// Reads for Settings → AI Connector, and the leak check.

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";
import { LEAK_CLIENT_ID, SECRET_KEY, SENSITIVE_KEY, appLabel, isMcpAdminRole, jsonKeys } from "./core";
import { listEndpointPaths } from "./reads";
import { mcpIdentity, readEndpoint } from "./server";
import { hasMcpAccess, issueTokens, mcpDb, revokeToken } from "./store";

type Row = Record<string, unknown>;
const q = async (db: DB, x: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(x)) as unknown as Row[];
const s = (r: Row, k: string): string => (r[k] == null ? "" : String(r[k]));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (r: Row | undefined, k: string): number => Number(r?.[k] ?? 0);

/** One display name per email: the person's newest active member row. */
const NAME_OF = sql`(select m.name from connect.member m where lower(m.email) = x.email order by m.active desc, m.created_at desc limit 1)`;

export type MyConnector = {
  allowed: boolean;
  isAdmin: boolean;
  pendingSince: string | null;
  apps: { tokenId: string; app: string; connectedAt: string | null; lastUsedAt: string | null }[];
};

export async function myConnector(db: DB, me: { email: string; role: string }): Promise<MyConnector> {
  await mcpDb(db);
  const email = me.email.toLowerCase();
  const [allowed, pending, apps] = await Promise.all([
    hasMcpAccess(db, email, me.role),
    q(db, sql`select created_at from connect.mcp_access_requests where email = ${email} and status = 'pending' and now() is not null order by created_at desc limit 1`),
    q(db, sql`
      select t.id, t.created_at, t.last_used_at, c.client_name
      from connect.mcp_tokens t left join connect.mcp_oauth_clients c on c.client_id = t.client_id
      where t.email = ${email} and t.revoked_at is null and t.refresh_expires_at > now() and t.client_id <> ${LEAK_CLIENT_ID}
      order by t.created_at desc
    `),
  ]);
  return {
    allowed,
    isAdmin: isMcpAdminRole(me.role),
    pendingSince: pending[0] ? iso(pending[0].created_at) : null,
    apps: apps.map((r) => ({ tokenId: s(r, "id"), app: appLabel(s(r, "client_name")), connectedAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) })),
  };
}

export type AdminOverview = {
  stats: { connectedPeople: number; callsToday: number; refusedToday: number; waiting: number };
  requests: { id: string; email: string; name: string; company: string; reason: string; createdAt: string | null }[];
  connected: { tokenId: string; email: string; name: string; company: string; app: string; connectedAt: string | null; lastUsedAt: string | null }[];
  allowed: { email: string; name: string; approvedAt: string | null }[];
  calls: { id: string; name: string; company: string; app: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number; at: string | null }[];
  staff: { email: string; name: string; companies: string; admin: boolean }[];
};

export async function adminOverview(db: DB): Promise<AdminOverview> {
  await mcpDb(db);
  await ensureAccessTables(db).catch(() => {});
  const [stats, requests, connected, allowed, calls, staff] = await Promise.all([
    q(db, sql`select
      (select count(*)::int from connect.mcp_calls where created_at > now() - interval '24 hours') as calls,
      (select count(*)::int from connect.mcp_calls where created_at > now() - interval '24 hours' and not ok) as refused,
      (select count(distinct email)::int from connect.mcp_tokens where revoked_at is null and refresh_expires_at > now() and client_id <> ${LEAK_CLIENT_ID}) as people,
      (select count(*)::int from connect.mcp_access_requests where status = 'pending') as waiting`),
    q(db, sql`
      select r.id, r.email, r.name, r.reason, r.created_at, co.name as company
      from connect.mcp_access_requests r left join connect.company co on co.id = r.company_id
      where r.status = 'pending' and now() is not null order by r.created_at
    `),
    q(db, sql`
      select t.id, t.email, t.created_at, t.last_used_at, c.client_name, m.name, co.name as company
      from connect.mcp_tokens t
      left join connect.mcp_oauth_clients c on c.client_id = t.client_id
      left join connect.member m on m.id = t.member_id
      left join connect.company co on co.id = m.company_id
      where t.revoked_at is null and t.refresh_expires_at > now() and t.client_id <> ${LEAK_CLIENT_ID}
      order by t.last_used_at desc nulls last, t.created_at desc
    `),
    q(db, sql`select x.email, x.approved_at, ${NAME_OF} as name from connect.mcp_access x where now() is not null order by 3, 1`),
    q(db, sql`
      select k.id, k.tool, k.target, k.status, k.ok, k.note, k.ms, k.created_at, m.name, co.name as company, c.client_name
      from connect.mcp_calls k
      left join connect.member m on m.id = k.member_id
      left join connect.company co on co.id = k.company_id
      left join connect.mcp_oauth_clients c on c.client_id = k.client_id
      where now() is not null
      order by k.created_at desc limit 100
    `),
    q(db, sql`
      select lower(m.email) as email, min(m.name) as name, string_agg(distinct co.name, ', ') as companies,
        bool_or(m.role::text in ('SUPER_ADMIN', 'OWNER')) as admin
      from connect.member m join connect.company co on co.id = m.company_id
      where m.active and co.active
        and lower(m.email) not in (select email from connect.mcp_access)
        and lower(m.email) not in (select email from connect.access_removed)
      group by lower(m.email) order by 2
    `).catch(() => [] as Row[]),
  ]);
  return {
    stats: { connectedPeople: n(stats[0], "people"), callsToday: n(stats[0], "calls"), refusedToday: n(stats[0], "refused"), waiting: n(stats[0], "waiting") },
    requests: requests.map((r) => ({ id: s(r, "id"), email: s(r, "email"), name: s(r, "name") || s(r, "email"), company: s(r, "company"), reason: s(r, "reason"), createdAt: iso(r.created_at) })),
    connected: connected.map((r) => ({
      tokenId: s(r, "id"),
      email: s(r, "email"),
      name: s(r, "name") || s(r, "email"),
      company: s(r, "company"),
      app: appLabel(s(r, "client_name")),
      connectedAt: iso(r.created_at),
      lastUsedAt: iso(r.last_used_at),
    })),
    allowed: allowed.map((r) => ({ email: s(r, "email"), name: s(r, "name") || s(r, "email"), approvedAt: iso(r.approved_at) })),
    calls: calls.map((r) => ({
      id: s(r, "id"),
      name: s(r, "name"),
      company: s(r, "company"),
      app: appLabel(s(r, "client_name")),
      tool: s(r, "tool"),
      target: s(r, "target"),
      status: n(r, "status"),
      ok: r.ok === true,
      note: s(r, "note"),
      ms: n(r, "ms"),
      at: iso(r.created_at),
    })),
    staff: staff.map((r) => ({ email: s(r, "email"), name: s(r, "name"), companies: s(r, "companies"), admin: r.admin === true })),
  };
}

// ── leak check ────────────────────────────────────────────────────────────
// Runs the connector's real read path AS one approved non-admin account over
// every parameter-free list endpoint, through a real (temporary) token resolved
// by the same mcpIdentity() a connected AI app goes through. Field NAMES and
// outcomes only, never values. The token is revoked afterwards, whatever happens.

export type LeakRow = { path: string; outcome: "opened" | "refused" | "error"; status: number; hidden: string[]; sensitive: string[] };
export type LeakReport = { person: string; company: string; role: string; rows: LeakRow[] };

export function analyseBody(path: string, status: number, isError: boolean, body: unknown, removed: string[]): LeakRow {
  if (status === 401 || status === 403) return { path, outcome: "refused", status, hidden: [], sensitive: [] };
  if (isError) return { path, outcome: "error", status, hidden: [], sensitive: [] };
  const keys = [...jsonKeys(body)];
  return { path, outcome: "opened", status, hidden: [...removed].sort(), sensitive: keys.filter((k) => SENSITIVE_KEY.test(k) && !SECRET_KEY.test(k)).sort() };
}

export async function runLeakCheck(db: DB, email: string, preferCompanyId: string): Promise<LeakReport | { error: string }> {
  await mcpDb(db);
  const e = email.toLowerCase();
  const rows = await q(db, sql`
    select m.id, m.name, m.role::text as role, m.company_id, co.name as company
    from connect.member m join connect.company co on co.id = m.company_id
    where lower(m.email) = ${e} and m.active and now() is not null
    order by (m.company_id = ${preferCompanyId}) desc, m.created_at
    limit 1
  `);
  const m = rows[0];
  if (!m) return { error: "No active Connect account with that email." };
  if (isMcpAdminRole(s(m, "role"))) return { error: "Admins see everything — pick a staff account." };
  if (!(await hasMcpAccess(db, e, s(m, "role")))) return { error: "Turn on AI Connector for this person first (the check reads as them)." };

  await db.execute(sql`
    insert into connect.mcp_oauth_clients (client_id, client_name, redirect_uris) values (${LEAK_CLIENT_ID}, 'Leak check', '[]'::jsonb)
    on conflict (client_id) do nothing
  `);
  const tok = await issueTokens(db, { id: s(m, "id"), email: e }, LEAK_CLIENT_ID);
  const out: LeakRow[] = [];
  try {
    const id = await mcpIdentity(db, tok.accessToken);
    if (!id) return { error: "That account cannot use the connector right now (inactive or access removed)." };
    for (const path of listEndpointPaths()) {
      try {
        const r = await readEndpoint(db, id, path, { limit: 5 });
        out.push(analyseBody(path, r.status, !!r.result.isError, r.body, r.removed));
      } catch {
        out.push({ path, outcome: "error", status: 500, hidden: [], sensitive: [] });
      }
    }
  } finally {
    await revokeToken(db, tok.tokenId, null);
  }
  return { person: s(m, "name"), company: s(m, "company"), role: s(m, "role"), rows: out };
}

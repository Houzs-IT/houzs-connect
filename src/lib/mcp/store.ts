// AI Connector (MCP) storage — migration 0027, src/db/ensure-mcp.ts.
//
// Every read that decides access (token, access list, code) compares against
// Postgres `now()`, a stable function, so Hyperdrive never answers it from its
// read cache (src/db/fresh.ts): a Disconnect counts on the very next call.
// Tokens and codes are stored as SHA-256 hashes only.

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureMcpTables } from "@/db/ensure-mcp";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  MCP_REFRESH_PREFIX,
  MCP_TOKEN_PREFIX,
  REFRESH_TTL_MS,
  isMcpAdminRole,
  randomToken,
  sha256Hex,
} from "./core";

type Row = Record<string, unknown>;
const rows = async (db: DB, q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
const s = (r: Row | undefined, k: string): string => (r && r[k] != null ? String(r[k]) : "");

export async function mcpDb(db: DB): Promise<DB> {
  await ensureMcpTables(db);
  return db;
}

// ── access (who may connect) ──────────────────────────────────────────────

/** Connector admins always may; everyone else needs an approval (by email = the person). */
export async function hasMcpAccess(db: DB, email: string, role: string): Promise<boolean> {
  if (isMcpAdminRole(role)) return true;
  const r = await rows(db, sql`select email from connect.mcp_access where email = ${email.toLowerCase()} and now() is not null`);
  return r.length > 0;
}

export async function grantAccess(db: DB, email: string, byMemberId: string): Promise<void> {
  const e = email.toLowerCase();
  await db.execute(sql`
    insert into connect.mcp_access (email, approved_by_member_id) values (${e}, ${byMemberId})
    on conflict (email) do nothing
  `);
  await db.execute(sql`
    update connect.mcp_access_requests set status = 'approved', decided_by_member_id = ${byMemberId}, decided_at = now()
    where email = ${e} and status = 'pending'
  `);
}

/** Take access away and cut every connection the person has. Returns connections cut. */
export async function removeAccess(db: DB, email: string): Promise<number> {
  const e = email.toLowerCase();
  await db.execute(sql`delete from connect.mcp_access where email = ${e}`);
  return revokeEmailTokens(db, e);
}

export async function requestAccess(
  db: DB,
  me: { id: string; email: string; companyId: string; name: string },
  reason: string
): Promise<"requested" | "already"> {
  const e = me.email.toLowerCase();
  const open = await rows(db, sql`select id from connect.mcp_access_requests where email = ${e} and status = 'pending' and now() is not null`);
  if (open.length) return "already";
  await db.execute(sql`
    insert into connect.mcp_access_requests (id, email, member_id, company_id, name, reason, status)
    values (${`mcpr_${randomToken(12)}`}, ${e}, ${me.id}, ${me.companyId}, ${me.name}, ${reason.slice(0, 300) || null}, 'pending')
  `);
  return "requested";
}

/** Approve / reject a pending request. Returns the email it was for, or null when not pending. */
export async function decideRequest(db: DB, id: string, approve: boolean, byMemberId: string): Promise<string | null> {
  const r = await rows(db, sql`
    update connect.mcp_access_requests
    set status = ${approve ? "approved" : "rejected"}, decided_by_member_id = ${byMemberId}, decided_at = now()
    where id = ${id} and status = 'pending'
    returning email
  `);
  const email = s(r[0], "email");
  if (!email) return null;
  if (approve) await grantAccess(db, email, byMemberId);
  return email;
}

// ── clients ───────────────────────────────────────────────────────────────

export type McpClient = { clientId: string; clientName: string; redirectUris: string[] };

export async function getClient(db: DB, clientId: string): Promise<McpClient | null> {
  if (!clientId || clientId.length > 100) return null;
  const r = (await rows(db, sql`select client_id, client_name, redirect_uris from connect.mcp_oauth_clients where client_id = ${clientId}`))[0];
  if (!r) return null;
  const uris = Array.isArray(r.redirect_uris) ? (r.redirect_uris as unknown[]).map(String) : [];
  return { clientId: s(r, "client_id"), clientName: s(r, "client_name") || "AI app", redirectUris: uris };
}

export async function registerClient(db: DB, name: string, redirectUris: string[]): Promise<McpClient> {
  const clientId = `mcpc_${randomToken(18)}`;
  const clientName = (name || "AI app").slice(0, 80);
  await db.execute(sql`
    insert into connect.mcp_oauth_clients (client_id, client_name, redirect_uris)
    values (${clientId}, ${clientName}, ${JSON.stringify(redirectUris)}::jsonb)
  `);
  return { clientId, clientName, redirectUris };
}

// ── pending "Allow?" screens ──────────────────────────────────────────────

export type AuthRequest = { id: string; clientId: string; redirectUri: string; state: string; codeChallenge: string };

const toAuthRequest = (r: Row): AuthRequest => ({
  id: s(r, "id"),
  clientId: s(r, "client_id"),
  redirectUri: s(r, "redirect_uri"),
  state: s(r, "state"),
  codeChallenge: s(r, "code_challenge"),
});

export async function createAuthRequest(db: DB, a: Omit<AuthRequest, "id">): Promise<string> {
  const id = `mcpa_${randomToken(18)}`;
  await db.execute(sql`
    insert into connect.mcp_auth_requests (id, client_id, redirect_uri, state, code_challenge, expires_at)
    values (${id}, ${a.clientId}, ${a.redirectUri}, ${a.state || null}, ${a.codeChallenge}, now() + make_interval(secs => ${CODE_TTL_MS / 1000}))
  `);
  return id;
}

export async function getAuthRequest(db: DB, id: string): Promise<AuthRequest | null> {
  const r = (await rows(db, sql`
    select id, client_id, redirect_uri, state, code_challenge from connect.mcp_auth_requests where id = ${id} and expires_at > now()
  `))[0];
  return r ? toAuthRequest(r) : null;
}

/** Single use: whoever deletes the row owns the decision. */
export async function takeAuthRequest(db: DB, id: string): Promise<AuthRequest | null> {
  const r = (await rows(db, sql`
    delete from connect.mcp_auth_requests where id = ${id} and expires_at > now()
    returning id, client_id, redirect_uri, state, code_challenge
  `))[0];
  return r ? toAuthRequest(r) : null;
}

// ── authorization codes ───────────────────────────────────────────────────

export async function createCode(db: DB, a: { clientId: string; memberId: string; redirectUri: string; codeChallenge: string }): Promise<string> {
  const code = randomToken(32);
  await db.execute(sql`
    insert into connect.mcp_oauth_codes (code_hash, client_id, member_id, redirect_uri, code_challenge, expires_at)
    values (${await sha256Hex(code)}, ${a.clientId}, ${a.memberId}, ${a.redirectUri}, ${a.codeChallenge}, now() + make_interval(secs => ${CODE_TTL_MS / 1000}))
  `);
  return code;
}

/** Single use: the UPDATE claims the code; a replay finds used_at set and fails. */
export async function consumeCode(db: DB, code: string): Promise<{ clientId: string; memberId: string; redirectUri: string; codeChallenge: string } | null> {
  const r = (await rows(db, sql`
    update connect.mcp_oauth_codes set used_at = now()
    where code_hash = ${await sha256Hex(code)} and used_at is null and expires_at > now()
    returning client_id, member_id, redirect_uri, code_challenge
  `))[0];
  if (!r) return null;
  return { clientId: s(r, "client_id"), memberId: s(r, "member_id"), redirectUri: s(r, "redirect_uri"), codeChallenge: s(r, "code_challenge") };
}

// ── tokens ────────────────────────────────────────────────────────────────

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number; tokenId: string };

export async function issueTokens(db: DB, member: { id: string; email: string }, clientId: string): Promise<IssuedTokens> {
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const refreshToken = MCP_REFRESH_PREFIX + randomToken(32);
  const tokenId = `mcpt_${randomToken(12)}`;
  await db.execute(sql`
    insert into connect.mcp_tokens (id, member_id, email, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    values (${tokenId}, ${member.id}, ${member.email.toLowerCase()}, ${clientId},
      ${await sha256Hex(accessToken)}, now() + make_interval(secs => ${ACCESS_TTL_MS / 1000}),
      ${await sha256Hex(refreshToken)}, now() + make_interval(secs => ${REFRESH_TTL_MS / 1000}))
  `);
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId };
}

/** Rotate: the old refresh token (and access token) stop working the moment a new pair is issued. */
export async function refreshTokens(db: DB, refreshToken: string, clientId: string): Promise<(IssuedTokens & { memberId: string }) | null> {
  if (!refreshToken.startsWith(MCP_REFRESH_PREFIX)) return null;
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const newRefresh = MCP_REFRESH_PREFIX + randomToken(32);
  const r = (await rows(db, sql`
    update connect.mcp_tokens set
      access_hash = ${await sha256Hex(accessToken)}, access_expires_at = now() + make_interval(secs => ${ACCESS_TTL_MS / 1000}),
      refresh_hash = ${await sha256Hex(newRefresh)}, refresh_expires_at = now() + make_interval(secs => ${REFRESH_TTL_MS / 1000})
    where refresh_hash = ${await sha256Hex(refreshToken)} and client_id = ${clientId}
      and revoked_at is null and refresh_expires_at > now()
    returning id, member_id
  `))[0];
  if (!r) return null;
  return { accessToken, refreshToken: newRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId: s(r, "id"), memberId: s(r, "member_id") };
}

export type McpTokenRow = { tokenId: string; memberId: string; clientId: string };

export type McpTokenCheck = McpTokenRow & {
  /** The member row behind the token is active. */
  active: boolean;
  /** Connect access removed on the Team page (connect.access_removed). */
  removed: boolean;
  /** An AI Connector approval row exists (admins need none — the caller decides). */
  approved: boolean;
  /** Settings → Access ticks for this person in this company (lib/full-access.ts moduleChoices). */
  moduleChoices: { module: string; allowed: boolean }[];
};

/**
 * Everything the door needs about a connector token, in ONE round trip: the
 * token row (last_used_at stamped by the same UPDATE that validates it), and for
 * its member — active, access removed, AI Connector approval, Settings → Access
 * ticks. Before 2026-11-25 these were four or five sequential queries per
 * request (resolveAccessToken, isAccessRemoved, hasMcpAccess, moduleChoices).
 * Same rules, same tables, same comparisons (emails lower-cased, as those
 * helpers do). The UPDATE is never served from Hyperdrive's read cache, so a
 * Disconnect / Remove counts on the very next request. The caller still reads
 * the member row itself (with its department) and applies the rules.
 * Needs ensureAccessTables (module_access / access_removed) to have run.
 */
export async function checkAccessToken(db: DB, token: string): Promise<McpTokenCheck | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX) || token.length > 200) return null;
  const r = (await rows(db, sql`
    with t as (
      update connect.mcp_tokens set last_used_at = now()
      where access_hash = ${await sha256Hex(token)} and revoked_at is null and access_expires_at > now()
      returning id, member_id, client_id
    )
    select t.id, t.member_id, t.client_id,
      coalesce(m.active, false) as active,
      exists (select 1 from connect.access_removed ar where ar.email = lower(m.email)) as removed,
      exists (select 1 from connect.mcp_access a where a.email = lower(m.email)) as approved,
      coalesce((
        select json_agg(json_build_object('module', ma.module, 'allowed', ma.allowed))
        from connect.module_access ma where ma.company_id = m.company_id and ma.email = lower(m.email)
      ), '[]'::json) as module_choices
    from t left join connect.member m on m.id = t.member_id
  `))[0];
  if (!r) return null;
  const choices = Array.isArray(r.module_choices) ? (r.module_choices as { module: unknown; allowed: unknown }[]) : [];
  return {
    tokenId: s(r, "id"),
    memberId: s(r, "member_id"),
    clientId: s(r, "client_id"),
    active: r.active === true,
    removed: r.removed === true,
    approved: r.approved === true,
    moduleChoices: choices.map((c) => ({ module: String(c.module), allowed: c.allowed === true })),
  };
}

/** Revoke one connection; with `email`, only if it is that person's. */
export async function revokeToken(db: DB, tokenId: string, email: string | null): Promise<number> {
  const r = await rows(db, sql`
    update connect.mcp_tokens set revoked_at = now()
    where id = ${tokenId} and revoked_at is null ${email === null ? sql`` : sql`and email = ${email.toLowerCase()}`}
    returning id
  `);
  return r.length;
}

export async function revokeEmailTokens(db: DB, email: string): Promise<number> {
  const r = await rows(db, sql`
    update connect.mcp_tokens set revoked_at = now() where email = ${email.toLowerCase()} and revoked_at is null returning id
  `);
  return r.length;
}

// ── call log ──────────────────────────────────────────────────────────────

export type McpCallRow = { tokenId: string; memberId: string; email: string; companyId: string; clientId: string; tool: string; target: string; status: number; ok: boolean; note: string; ms: number };

/**
 * Every call of one request in ONE insert. server.ts hands this to waitUntil,
 * so the AI app's answer no longer waits for the log write. Never throws.
 */
/**
 * Tool calls this person (email) made in the last minute and the last 24 hours,
 * for the rate limit (server.ts callTool). Refused calls (status 429) do not
 * count, so waiting always frees the limit. Uses mcp_calls_email_idx (email, created_at).
 */
export async function countRecentCalls(db: DB, email: string): Promise<{ minute: number; day: number }> {
  const r = await rows(db, sql`
    select count(*) filter (where created_at > now() - interval '1 minute') as minute, count(*) as day
    from connect.mcp_calls
    where email = ${email.toLowerCase()} and created_at > now() - interval '1 day' and (status is null or status <> 429)
  `);
  return { minute: Number(r[0]?.minute ?? 0), day: Number(r[0]?.day ?? 0) };
}

export async function logCalls(db: DB, calls: McpCallRow[]): Promise<void> {
  if (!calls.length) return;
  try {
    const values = calls.map(
      (c) => sql`(${`mcpl_${randomToken(12)}`}, ${c.tokenId}, ${c.memberId}, ${c.email.toLowerCase()}, ${c.companyId}, ${c.clientId},
        ${c.tool.slice(0, 60)}, ${c.target.slice(0, 500)}, ${c.status}, ${c.ok}, ${c.note.slice(0, 300)}, ${c.ms})`
    );
    await db.execute(sql`
      insert into connect.mcp_calls (id, token_id, member_id, email, company_id, client_id, tool, target, status, ok, note, ms)
      values ${sql.join(values, sql`, `)}
    `);
  } catch (e) {
    console.warn("[mcp] call log failed:", e instanceof Error ? e.message : String(e));
  }
}

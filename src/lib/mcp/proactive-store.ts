// Storage for AI Connector round 4d (morning brief + urgent alerts) — migration
// 0029, self-applied by src/db/ensure-mcp.ts. Pure logic lives in proactive.ts.
//
//   mcp_brief_subscriptions  one row per member (a person in one company) who
//                            saved the settings; the random token in each
//                            email's unsubscribe link; the last alert check.
//   mcp_proactive_keys       the debounce / idempotency ledger: member + key +
//                            Malaysia day. "brief" is a key too, so a second
//                            tick cannot send a second brief (INSERT ... ON
//                            CONFLICT DO NOTHING RETURNING = the claim).
//   mcp_proactive_sends      the send log — who, which kind, how many items, the
//                            provider's message id, status. NEVER the body.
//
// Every read that decides who gets mail compares against now() so Hyperdrive
// never answers it from its read cache (src/db/fresh.ts), like store.ts.

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";
import { ensureMcpTables } from "@/db/ensure-mcp";
import { PROACTIVE_CLIENT_ID, randomToken } from "./core";
import { subscriptionFromRow, type Subscription } from "./proactive";

type Row = Record<string, unknown>;
const rows = async (db: DB, q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
const s = (r: Row | undefined, k: string): string => (r && r[k] != null ? String(r[k]) : "");
const iso = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export { PROACTIVE_CLIENT_ID };

/** An unsubscribe token can only ever be one of ours: base64url, the length randomToken(24) makes. */
export const UNSUB_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

// ── subscriptions ───────────────────────────────────────────────────────────

export async function getSubscription(db: DB, memberId: string): Promise<Subscription | null> {
  await ensureMcpTables(db);
  const r = (await rows(db, sql`select * from connect.mcp_brief_subscriptions where member_id = ${memberId} and now() is not null`))[0];
  return r ? subscriptionFromRow(r) : null;
}

/** Insert or update; the unsubscribe token is made once and kept. */
export async function saveSubscription(db: DB, sub: Subscription, email: string): Promise<void> {
  await ensureMcpTables(db);
  await db.execute(sql`
    insert into connect.mcp_brief_subscriptions (member_id, email, brief_enabled, brief_time, brief_days, alerts_enabled, unsub_token)
    values (${sub.memberId}, ${email.toLowerCase()}, ${sub.briefEnabled}, ${sub.briefTime}, ${sub.briefDays}, ${sub.alertsEnabled}, ${randomToken(24)})
    on conflict (member_id) do update set email = excluded.email, brief_enabled = excluded.brief_enabled, brief_time = excluded.brief_time,
      brief_days = excluded.brief_days, alerts_enabled = excluded.alerts_enabled, updated_at = now()
  `);
}

/** The token in this person's unsubscribe link (made on first save). */
export async function unsubscribeToken(db: DB, memberId: string): Promise<string> {
  await ensureMcpTables(db);
  return s((await rows(db, sql`select unsub_token from connect.mcp_brief_subscriptions where member_id = ${memberId} and now() is not null`))[0], "unsub_token");
}

/**
 * The unsubscribe link: brief AND alerts off for whoever holds this token (the
 * token alone identifies the person — no member id in the link). Returns
 * { memberId, email }, or null for an unknown / malformed token.
 */
export async function unsubscribeWithToken(db: DB, token: string): Promise<{ memberId: string; email: string } | null> {
  if (!UNSUB_TOKEN_RE.test(token)) return null;
  await ensureMcpTables(db);
  const r = (await rows(db, sql`
    update connect.mcp_brief_subscriptions set brief_enabled = false, alerts_enabled = false, updated_at = now()
    where unsub_token = ${token} returning member_id, email
  `))[0];
  return r ? { memberId: s(r, "member_id"), email: s(r, "email") } : null;
}

/** Who already holds `key` for `day` — one query (e.g. who got today's brief). */
export async function membersWithKey(db: DB, key: string, day: string): Promise<Set<string>> {
  await ensureMcpTables(db);
  const r = await rows(db, sql`select member_id from connect.mcp_proactive_keys where alert_key = ${key} and day = ${day} and now() is not null`);
  return new Set(r.map((x) => s(x, "member_id")));
}

export type Subscriber = Subscription & { email: string; name: string; role: string; companyId: string; company: string; lastAlertCheckAt: string };

/**
 * Everyone opted in to anything, with their member row — ONE query. Only
 * active members with an email, whose Connect access was not removed, and who
 * may use the AI Connector (an approval, or Super Admin / Owner). The tick
 * still reads through mcpIdentity, which re-checks every rule.
 */
export async function activeSubscribers(db: DB): Promise<Subscriber[]> {
  await Promise.all([ensureMcpTables(db), ensureAccessTables(db)]);
  const r = await rows(db, sql`
    select b.*, m.email as member_email, m.name, m.role::text as role, m.company_id, co.name as company
    from connect.mcp_brief_subscriptions b
    join connect.member m on m.id = b.member_id
    left join connect.company co on co.id = m.company_id
    where (b.brief_enabled or b.alerts_enabled)
      and m.active and coalesce(m.email, '') like '%@%'
      and not exists (select 1 from connect.access_removed ar where ar.email = lower(m.email))
      and (m.role::text in ('SUPER_ADMIN', 'OWNER') or exists (select 1 from connect.mcp_access a where a.email = lower(m.email)))
      and now() is not null
  `);
  return r.map((x) => ({
    ...subscriptionFromRow(x),
    email: s(x, "member_email").trim().toLowerCase(),
    name: s(x, "name").trim() || s(x, "member_email"),
    role: s(x, "role").toUpperCase(),
    companyId: s(x, "company_id"),
    company: s(x, "company"),
    lastAlertCheckAt: x.last_alert_check_at == null ? "" : iso(x.last_alert_check_at),
  }));
}

export async function markAlertChecked(db: DB, memberId: string): Promise<void> {
  await db.execute(sql`update connect.mcp_brief_subscriptions set last_alert_check_at = now() where member_id = ${memberId}`);
}

// ── the debounce / idempotency ledger ───────────────────────────────────────

/** key -> the latest day it was sent to this person, for these keys, since `sinceDay`. One query. */
export async function sentKeys(db: DB, memberId: string, keys: string[], sinceDay: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(keys)];
  if (!uniq.length) return out;
  await ensureMcpTables(db);
  const r = await rows(db, sql`
    select alert_key, max(day) as day from connect.mcp_proactive_keys
    where member_id = ${memberId} and day >= ${sinceDay} and alert_key in (${sql.join(uniq.map((k) => sql`${k}`), sql`, `)}) and now() is not null
    group by alert_key
  `);
  for (const x of r) out.set(s(x, "alert_key"), s(x, "day"));
  return out;
}

/**
 * Claim keys for today: returns only the keys THIS call inserted. A key already
 * claimed today (another tick, a retry) comes back missing, so it is never sent
 * twice. One statement.
 */
export async function claimKeys(db: DB, memberId: string, keys: string[], day: string): Promise<string[]> {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return [];
  await ensureMcpTables(db);
  const values = uniq.map((k) => sql`(${memberId}, ${k.slice(0, 200)}, ${day})`);
  const r = await rows(db, sql`
    insert into connect.mcp_proactive_keys (member_id, alert_key, day) values ${sql.join(values, sql`, `)}
    on conflict (member_id, alert_key, day) do nothing returning alert_key
  `);
  return r.map((x) => s(x, "alert_key"));
}

/** Give a claim back (the email could not be built or sent — a later tick may retry today). */
export async function releaseKeys(db: DB, memberId: string, keys: string[], day: string): Promise<void> {
  if (!keys.length) return;
  await db.execute(sql`delete from connect.mcp_proactive_keys where member_id = ${memberId} and day = ${day} and alert_key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
}

// ── the send log (never the body) ───────────────────────────────────────────

export type SendKind = "brief" | "brief_test" | "alert" | "unsubscribe";
export type SendStatus = "sent" | "failed" | "skipped";

export async function logSend(db: DB, x: { memberId: string; email: string; kind: SendKind; day: string; items: number; providerId: string | null; status: SendStatus; note?: string }): Promise<void> {
  try {
    await ensureMcpTables(db);
    await db.execute(sql`
      insert into connect.mcp_proactive_sends (id, member_id, email, kind, day, items, provider_id, status, note)
      values (${`mcps_${randomToken(12)}`}, ${x.memberId}, ${x.email.toLowerCase()}, ${x.kind}, ${x.day}, ${x.items}, ${x.providerId}, ${x.status}, ${(x.note ?? "").slice(0, 200)})
    `);
  } catch (e) {
    console.warn("[mcp-proactive] send log failed:", e instanceof Error ? e.message : String(e));
  }
}

export type SendRow = { at: string; kind: string; items: number; status: string; note: string };

export async function recentSends(db: DB, memberId: string, limit = 10): Promise<SendRow[]> {
  await ensureMcpTables(db);
  const r = await rows(db, sql`
    select kind, items, status, note, created_at from connect.mcp_proactive_sends
    where member_id = ${memberId} and now() is not null order by created_at desc limit ${limit}
  `);
  return r.map((x) => ({ at: iso(x.created_at), kind: s(x, "kind"), items: Number(s(x, "items")) || 0, status: s(x, "status"), note: s(x, "note") }));
}

/** For the admin: how many proactive emails went out in the last 24 hours. */
export async function sendsToday(db: DB): Promise<number> {
  await ensureMcpTables(db);
  const r = await rows(db, sql`select count(*) as n from connect.mcp_proactive_sends where status = 'sent' and created_at > now() - interval '1 day'`);
  return Number(r[0]?.n ?? 0);
}

// AI Connector round 4d: the morning brief email (D1), urgent alerts (D2) and
// the Monday data-gaps list (D4) — the part that reads and sends. Pure logic is
// in proactive.ts; storage in proactive-store.ts.
//
// AS THE PERSON, ALWAYS. Each person gets a short-lived connector token of their
// own (client mcpc_morning_brief), revoked in `finally` — the leak check's
// pattern (admin.ts). The brief is the daily_brief tool (and data_gaps) run
// through handleRpc, so the call is gated, rate-limited and logged exactly like
// a question from Claude; the alert reads go through readEndpoint — the same
// module gate and visibility as any connector read. mcpIdentity re-checks every
// access rule (active, access not removed, AI Connector approval, modules).
// There is no service account.
//
// BOUNDED + IDEMPOTENT. Driven by /api/cron (every 2 minutes). At most
// maxBriefsPerTick briefs and maxPeoplePerTick alert checks per tick, people one
// at a time, a tickBudgetMs budget. One brief per person per Malaysia day (key
// "brief" claimed before building); each alert key at most once per person per
// day (claimed before sending). Every email is logged in mcp_proactive_sends —
// never its body. No email is ever sent while mail is not configured.

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { mailOffReason, sendMail, type MailEnv, type MailMessage, type MailResult } from "@/lib/mail";

/** How an email leaves. Default: Resend (lib/mail.ts). Tests pass a fake — nothing real is ever sent from a test. */
export type Sender = (m: MailMessage) => Promise<MailResult>;
const resend = (env: MailEnv): Sender => (m) => sendMail(env, m);
import {
  alertsToSend,
  buildAlertEmail,
  buildBriefEmail,
  computeAlerts,
  debounceSince,
  DEFAULT_SUBSCRIPTION,
  isMonday,
  mytNow,
  pickTickWork,
  plusDays,
  PROACTIVE_CONFIG,
  thresholdsForDisplay,
  type MytNow,
} from "./proactive";
import {
  activeSubscribers,
  claimKeys,
  getSubscription,
  logSend,
  markAlertChecked,
  membersWithKey,
  recentSends,
  PROACTIVE_CLIENT_ID,
  releaseKeys,
  saveSubscription,
  sentKeys,
  unsubscribeToken,
  type Subscriber,
} from "./proactive-store";
import { moodScanAllowed } from "./round3";
import { parseAnswer } from "./round4c";
import { handleRpc, mcpIdentity, readEndpoint, type Identity, type ToolResult } from "./server";
import { issueTokens, revokeToken } from "./store";

type Obj = Record<string, unknown>;

/** The person a brief / alert check is for: one member row (one company). */
export type Person = { memberId: string; email: string; name: string; company: string };

/** In words, for Settings -> AI Connector. */
export const SCHEDULE_WORDS =
  "Checked every 2 minutes by the Houzs Connect scheduler. Your brief goes out on the first check at or after your time; alerts are checked every 30 minutes, 08:00–22:00 Malaysia time.";

export const settingsUrl = (origin: string) => `${origin}/settings/ai-connector`;
export const unsubscribeUrl = (origin: string, token: string) => (token ? `${origin}/api/mcp/unsubscribe?t=${encodeURIComponent(token)}` : "");

let clientReady = false;
async function ensureProactiveClient(db: DB): Promise<void> {
  if (clientReady) return;
  await db.execute(sql`
    insert into connect.mcp_oauth_clients (client_id, client_name, redirect_uris) values (${PROACTIVE_CLIENT_ID}, 'Morning brief', '[]'::jsonb)
    on conflict (client_id) do nothing
  `);
  clientReady = true;
}

export class NoConnectorAccess extends Error {}

/** Run `fn` as the person, with a fresh connector token of their own; always revoked afterwards. */
export async function withPersonToken<T>(db: DB, p: Person, fn: (id: Identity) => Promise<T>): Promise<T> {
  await ensureProactiveClient(db);
  const tok = await issueTokens(db, { id: p.memberId, email: p.email }, PROACTIVE_CLIENT_ID);
  try {
    const id = await mcpIdentity(db, tok.accessToken);
    if (!id) throw new NoConnectorAccess("this account cannot use the AI Connector right now (inactive, access removed or not approved)");
    return await fn(id);
  } finally {
    await revokeToken(db, tok.tokenId, null).catch(() => 0);
  }
}

/** A tool's answer as the person, through the same handleRpc path as Claude (gated, rate-limited, logged). */
async function toolAs(db: DB, id: Identity, name: string, origin: string): Promise<{ ok: true; value: Obj } | { ok: false; message: string }> {
  const reply = (await handleRpc(db, id, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }, origin)) as { result?: ToolResult } | null;
  const r = reply?.result;
  if (!r) return { ok: false, message: "no answer" };
  const t = r.content[0]?.text ?? "";
  if (r.isError) return { ok: false, message: t.slice(0, 200) };
  const sc = r.structuredContent;
  if (sc && sc.truncated !== true) return { ok: true, value: sc };
  const v = parseAnswer(t);
  return v ? { ok: true, value: v } : { ok: false, message: "the answer could not be read" };
}

export type BuiltBrief = { ok: true; subject: string; html: string; text: string; items: number } | { ok: false; message: string };

/** The brief AS THE PERSON: daily_brief (+ data_gaps on Monday / on request). */
export async function buildBriefAs(db: DB, p: Person, id: Identity, origin: string, now: MytNow, opts: { withGaps: boolean; test?: boolean }): Promise<BuiltBrief> {
  const b = await toolAs(db, id, "daily_brief", origin);
  if (!b.ok) return { ok: false, message: `daily_brief: ${b.message}` };
  let gaps: Obj | null = null;
  if (opts.withGaps) {
    const g = await toolAs(db, id, "data_gaps", origin);
    gaps = g.ok ? g.value : null; // no access to any of its lists -> no gaps section
  }
  const mail = buildBriefEmail({
    brief: b.value,
    gaps,
    name: p.name,
    company: p.company,
    date: now.day,
    settingsUrl: settingsUrl(origin),
    unsubscribeUrl: unsubscribeUrl(origin, await unsubscribeToken(db, p.memberId)),
    test: opts.test,
  });
  return { ok: true, ...mail };
}

/** The alert reads AS THE PERSON. A read they may not make comes back null. Supervisor-only reads only for supervisors. */
async function alertReads(db: DB, id: Identity, now: MytNow) {
  const val = (r: Awaited<ReturnType<typeof readEndpoint>>) => (r.result.isError ? null : r.body);
  if (!moodScanAllowed(id.me.role)) {
    const mine = await readEndpoint(db, id, "/inbox/waiting", { assigned: "me", limit: 50 });
    return { waiting: null, myWaiting: val(mine), reviewToday: null, reviewWeek: null };
  }
  const from = plusDays(now.day, -(PROACTIVE_CONFIG.alerts.complainerWindowDays - 1));
  const [waiting, today, week] = await Promise.all([
    readEndpoint(db, id, "/inbox/waiting", { limit: 50 }),
    readEndpoint(db, id, "/inbox/chat-review", { period: "today" }),
    readEndpoint(db, id, "/inbox/chat-review", { period: "custom", from, to: now.day }),
  ]);
  return { waiting: val(waiting), myWaiting: null, reviewToday: val(today), reviewWeek: val(week) };
}

type PersonResult = { brief?: "sent" | "failed" | "already" | "gave-up"; alerts?: number; alertError?: string; noAccess?: boolean };

const BRIEF_TRIES = ["brief_try:1", "brief_try:2", "brief_try:3"];

/** One person on one tick: the brief if due, then the alert check if due. Never throws. */
async function runPerson(db: DB, send: Sender, s: Subscriber, now: MytNow, origin: string, wantBrief: boolean, wantAlerts: boolean): Promise<PersonResult> {
  const out: PersonResult = {};
  const p: Person = { memberId: s.memberId, email: s.email, name: s.name, company: s.company };
  try {
    await withPersonToken(db, p, async (id) => {
      if (wantBrief) {
        const claimed = await claimKeys(db, s.memberId, ["brief"], now.day);
        if (!claimed.length) out.brief = "already";
        else {
          // At most three attempts a day: a broken brief must not retry every 2 minutes for hours.
          let attempt = "";
          for (const k of BRIEF_TRIES) if (!attempt && (await claimKeys(db, s.memberId, [k], now.day)).length) attempt = k;
          if (!attempt) {
            out.brief = "gave-up"; // keeps the "brief" claim: no more tries today
          } else {
            const withGaps = isMonday(now);
            try {
              const built = await buildBriefAs(db, p, id, origin, now, { withGaps });
              if (!built.ok) throw new Error(built.message);
              const sent = await send({ to: s.email, subject: built.subject, html: built.html, text: built.text });
              if (!sent.ok) throw new Error(sent.error);
              await logSend(db, { memberId: s.memberId, email: s.email, kind: "brief", day: now.day, items: built.items, providerId: sent.id, status: "sent", note: withGaps ? "with data gaps" : "" });
              out.brief = "sent";
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (attempt !== BRIEF_TRIES[BRIEF_TRIES.length - 1]) await releaseKeys(db, s.memberId, ["brief"], now.day).catch(() => {});
              await logSend(db, { memberId: s.memberId, email: s.email, kind: "brief", day: now.day, items: 0, providerId: null, status: "failed", note: `${attempt}: ${msg}` });
              out.brief = "failed";
            }
          }
        }
      }
      if (wantAlerts) {
        let claimed: string[] = [];
        try {
          const reads = await alertReads(db, id, now);
          const nowMs = Date.now();
          const alerts = computeAlerts({ origin, nowMs, role: id.me.role, ...reads });
          const fresh = alertsToSend(alerts, await sentKeys(db, s.memberId, alerts.map((a) => a.key), debounceSince(now.day)), now.day);
          claimed = await claimKeys(db, s.memberId, fresh.map((a) => a.key), now.day);
          const due = fresh.filter((a) => claimed.includes(a.key));
          if (due.length) {
            const mail = buildAlertEmail({ alerts: due, date: now.day, settingsUrl: settingsUrl(origin), unsubscribeUrl: unsubscribeUrl(origin, await unsubscribeToken(db, s.memberId)) });
            const sent = await send({ to: s.email, subject: mail.subject, html: mail.html, text: mail.text });
            if (!sent.ok) throw new Error(sent.error);
            await logSend(db, { memberId: s.memberId, email: s.email, kind: "alert", day: now.day, items: due.length, providerId: sent.id, status: "sent", note: [...new Set(due.map((a) => a.kind))].join(",") });
          }
          out.alerts = due.length;
        } catch (e) {
          // Give the keys back so the next check may send them.
          await releaseKeys(db, s.memberId, claimed, now.day).catch(() => {});
          out.alertError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
          await logSend(db, { memberId: s.memberId, email: s.email, kind: "alert", day: now.day, items: 0, providerId: null, status: "failed", note: out.alertError });
        } finally {
          await markAlertChecked(db, s.memberId).catch(() => {});
        }
      }
    });
  } catch (e) {
    if (!(e instanceof NoConnectorAccess)) throw e;
    out.noAccess = true;
    if (wantAlerts) await markAlertChecked(db, s.memberId).catch(() => {});
  }
  return out;
}

export type TickSummary =
  | { skipped: string }
  | { subscribers: number; briefsSent: number; briefsFailed: number; alertEmails: number; alertLines: number; alertErrors: number; noAccess: number; peopleDone: number; peopleDeferred: number; ms: number };

/**
 * One scheduler tick (POST /api/cron). Does nothing at all while mail is not
 * configured. Otherwise: one query for the opted-in people, then the due briefs
 * and alert checks, bounded (proactive.pickTickWork + tickBudgetMs).
 */
export async function runProactiveTick(db: DB, env: MailEnv, origin: string, at: Date = new Date(), send: Sender = resend(env)): Promise<TickSummary> {
  const off = mailOffReason(env);
  if (off) return { skipped: "email not configured" };
  const t0 = Date.now();
  const now = mytNow(at);
  const subs = await activeSubscribers(db);
  const empty = { subscribers: subs.length, briefsSent: 0, briefsFailed: 0, alertEmails: 0, alertLines: 0, alertErrors: 0, noAccess: 0, peopleDone: 0, peopleDeferred: 0, ms: 0 };
  if (!subs.length) return { ...empty, ms: Date.now() - t0 };
  const work = pickTickWork(subs, now, await membersWithKey(db, "brief", now.day));
  const byId = new Map<string, { s: Subscriber; brief: boolean; alerts: boolean }>();
  for (const s of work.briefs) byId.set(s.memberId, { s, brief: true, alerts: false });
  for (const s of work.alerts) byId.set(s.memberId, { s, brief: byId.get(s.memberId)?.brief ?? false, alerts: true });
  const c = { ...empty };
  for (const { s, brief, alerts } of byId.values()) {
    if (Date.now() - t0 > PROACTIVE_CONFIG.tickBudgetMs) {
      c.peopleDeferred += 1;
      continue;
    }
    try {
      const r = await runPerson(db, send, s, now, origin, brief, alerts);
      if (r.brief === "sent") c.briefsSent += 1;
      if (r.brief === "failed") c.briefsFailed += 1;
      if (r.alerts) {
        c.alertEmails += 1;
        c.alertLines += r.alerts;
      }
      if (r.alertError) c.alertErrors += 1;
      if (r.noAccess) c.noAccess += 1;
    } catch (e) {
      console.warn("[mcp-proactive] person failed:", e instanceof Error ? e.message : String(e));
      c.alertErrors += 1;
    }
    c.peopleDone += 1;
  }
  return { ...c, ms: Date.now() - t0 };
}

/** The brief as it would be sent now — built as the person, NOT sent. */
export async function previewBrief(db: DB, p: Person, origin: string, withGaps: boolean, at: Date = new Date()): Promise<BuiltBrief> {
  const now = mytNow(at);
  try {
    return await withPersonToken(db, p, (id) => buildBriefAs(db, p, id, origin, now, { withGaps: withGaps || isMonday(now) }));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** "Send me a test brief now" — to the person's own email only, at most once per 10 minutes. */
export async function sendTestBrief(db: DB, env: MailEnv, p: Person, origin: string, send: Sender = resend(env)): Promise<{ ok: true; sentTo: string; items: number } | { ok: false; error: string }> {
  const off = mailOffReason(env);
  if (off) return { ok: false, error: off };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return { ok: false, error: "Your Connect account has no email address." };
  const now = mytNow();
  const bucket = `brief_test:${now.hhmm.slice(0, 4)}`; // HH:M — one per 10 minutes
  if (!(await claimKeys(db, p.memberId, [bucket], now.day)).length) {
    return { ok: false, error: "A test brief was sent in the last few minutes — check your inbox, or try again in 10 minutes." };
  }
  // Settings saved once, so the email carries a working unsubscribe link.
  if (!(await getSubscription(db, p.memberId))) await saveSubscription(db, { memberId: p.memberId, ...DEFAULT_SUBSCRIPTION }, p.email);
  let built: BuiltBrief;
  try {
    built = await withPersonToken(db, p, (id) => buildBriefAs(db, p, id, origin, now, { withGaps: true, test: true }));
  } catch (e) {
    built = { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!built.ok) {
    await releaseKeys(db, p.memberId, [bucket], now.day).catch(() => {});
    await logSend(db, { memberId: p.memberId, email: p.email, kind: "brief_test", day: now.day, items: 0, providerId: null, status: "failed", note: built.message });
    return { ok: false, error: `The brief could not be built: ${built.message}` };
  }
  const sent = await send({ to: p.email, subject: built.subject, html: built.html, text: built.text });
  await logSend(db, { memberId: p.memberId, email: p.email, kind: "brief_test", day: now.day, items: built.items, providerId: sent.ok ? sent.id : null, status: sent.ok ? "sent" : "failed", note: sent.ok ? "with data gaps" : sent.error });
  if (!sent.ok) return { ok: false, error: `The email could not be sent: ${sent.error}` };
  return { ok: true, sentTo: p.email, items: built.items };
}

export type MyBriefSettings = {
  allowed: boolean;
  email: string;
  saved: boolean;
  subscription: { briefEnabled: boolean; briefTime: string; briefDays: "weekdays" | "daily"; alertsEnabled: boolean };
  thresholds: { label: string; value: string }[];
  schedule: string;
  /** Why nothing is sent (no key / preview copy), or null when email works. */
  mailOff: string | null;
  supervisor: boolean;
  recent: { at: string; kind: string; items: number; status: string; note: string }[];
};

/** Settings -> AI Connector: this person's own brief / alert settings (read-only thresholds included). */
export async function myBriefSettings(db: DB, env: MailEnv, me: { id: string; email: string; role: string }, allowed: boolean): Promise<MyBriefSettings> {
  const sub = await getSubscription(db, me.id);
  const s = sub ?? { memberId: me.id, ...DEFAULT_SUBSCRIPTION };
  return {
    allowed,
    email: me.email,
    saved: !!sub,
    subscription: { briefEnabled: s.briefEnabled, briefTime: s.briefTime, briefDays: s.briefDays, alertsEnabled: s.alertsEnabled },
    thresholds: thresholdsForDisplay(),
    schedule: SCHEDULE_WORDS,
    mailOff: mailOffReason(env),
    supervisor: moodScanAllowed(me.role),
    recent: allowed ? await recentSends(db, me.id, 10) : [],
  };
}

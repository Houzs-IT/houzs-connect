// AI Connector round 3 (owner 2026-11-26) — the pure parts: reply_speed,
// message_delivery, contacts_summary, campaign_summary, customer_mood_scan,
// daily_brief, export_excel columns, the daily-brief prompt and the rate limit.
// No DB, no network, no Next. Pinned by scripts/smoke-mcp.mjs (CI).
//
// The reads behind them are catalogue endpoints in reads.ts, run through
// server.ts readEndpoint like every other read: the person's modules, the inbox
// rail's visibility and the credential stripping all apply. Nothing here decides
// who may see what — except customer_mood_scan's role gate, which the owner set
// (supervisors and admins only) and which uses Connect's own roles.

import { SLA_MINUTES } from "@/lib/sla";
import { dur, pctChange, type ReplyLike } from "./quick";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const msOf = (v: unknown): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const tally = (rows: Obj[], key: (r: Obj) => string): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || "(none)";
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};

export { SLA_MINUTES };

// ── dates (Malaysia calendar days) ─────────────────────────────────────────

const MY_MS = 8 * 3600_000;
const DAY_MS = 86_400_000;

/** Today in Malaysia as YYYY-MM-DD. */
export function myToday(now: number = Date.now()): string {
  return new Date(now + MY_MS).toISOString().slice(0, 10);
}

/** Malaysia midnight starting a YYYY-MM-DD. */
export function myMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+08:00`);
}

/** A YYYY-MM-DD n days before / after another. */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A from..to range of Malaysia days (inclusive), at most `maxDays` long, not in
 * the future. Default: today. Returns the [start, end) instants.
 */
export function dayRange(fromRaw: unknown, toRaw: unknown, maxDays: number, now: number = Date.now()): { from: string; to: string; start: Date; end: Date } | { error: string } {
  const today = myToday(now);
  const from = str(fromRaw).trim() || str(toRaw).trim() || today;
  let to = str(toRaw).trim() || (str(fromRaw).trim() ? from : today);
  if (!YMD.test(from) || !YMD.test(to)) return { error: "Give dates as YYYY-MM-DD." };
  if (to > today) to = today;
  if (from > to) return { error: "from must be on or before to, and not in the future." };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > maxDays) return { error: `At most ${maxDays} days at a time.` };
  return { from, to, start: myMidnight(from), end: myMidnight(shiftDay(to, 1)) };
}

// ── reply_speed ─────────────────────────────────────────────────────────────

export type WaitingRow = { id: string; customer: string; assignedTo: string | null; department: string | null; channel: string | null; since: Date | string | null };

/** One replyStats window, short. */
function replyWindow(label: string, r: ReplyLike) {
  return {
    window: label,
    customersWhoWrote: r.asked,
    answered: r.answered,
    replyRatePct: r.asked ? Math.round((r.answered / r.asked) * 1000) / 10 : null,
    answeredByAPerson: r.answeredHuman,
    avgFirstHumanReply: dur(r.avgFirst),
    avgReply: dur(r.avgReply),
    avgFirstHumanReplySeconds: r.avgFirst == null ? null : Math.round(r.avgFirst),
  };
}

/**
 * reply_speed: the dashboard's own replyStats for today, yesterday and the last
 * 7 days, per member (who actually sent the reply), and the conversations
 * waiting on us longer than SLA_MINUTES.
 */
export function summariseReplySpeed(
  w: { today: ReplyLike; yesterday: ReplyLike; last7: ReplyLike },
  names: Map<string, string>,
  waiting: WaitingRow[],
  waitingTotal: number,
  now: number = Date.now(),
  slaMinutes = SLA_MINUTES
) {
  const people = new Map<string, { name: string; today: number[]; todayFirst: number[]; week: number[]; weekFirst: number[] }>();
  const add = (r: ReplyLike, k: "today" | "week") => {
    for (const [id, v] of r.byAgent.entries()) {
      const p = people.get(id) ?? { name: names.get(id) ?? "—", today: [], todayFirst: [], week: [], weekFirst: [] };
      p[k].push(...v.all);
      p[k === "today" ? "todayFirst" : "weekFirst"].push(...v.first);
      people.set(id, p);
    }
  };
  add(w.today, "today");
  add(w.last7, "week");
  const byMember = [...people.values()]
    .map((p) => ({
      name: p.name,
      repliesToday: p.today.length,
      avgReplyToday: dur(avg(p.today)),
      avgFirstReplyToday: dur(avg(p.todayFirst)),
      replies7d: p.week.length,
      avgReply7d: dur(avg(p.week)),
      avgFirstReply7d: dur(avg(p.weekFirst)),
      firstReplyOverSla7d: avg(p.weekFirst) != null && (avg(p.weekFirst) as number) > slaMinutes * 60,
    }))
    .sort((a, b) => b.replies7d - a.replies7d || b.repliesToday - a.repliesToday)
    .slice(0, 20);
  const t = w.today.avgFirst;
  const y = w.yesterday.avgFirst;
  return {
    slaMinutes,
    timing: w.today.businessHours ? "business hours only" : "clock time",
    today: replyWindow("today (Malaysia time)", w.today),
    yesterday: replyWindow("yesterday", w.yesterday),
    last7Days: replyWindow("last 7 days, today included", w.last7),
    firstReplyTodayVsYesterdayPct: t == null || y == null ? null : pctChange(t, y),
    byMember,
    waitingOverSla: {
      count: waitingTotal,
      longest: waiting.slice(0, 15).map((r) => {
        const since = msOf(r.since);
        return {
          conversationId: r.id,
          customer: r.customer,
          waiting: since == null ? null : dur(Math.max(0, (now - since) / 1000)),
          assignedTo: r.assignedTo ?? "(unassigned)",
          department: r.department,
          channel: r.channel,
        };
      }),
    },
    note: `Same measurement as the Dashboard: first reply = first message from a PERSON (bots do not count); reply rate counts any reply. Waiting = not closed and the customer wrote last, for longer than ${slaMinutes} minutes.`,
  };
}

// ── message_delivery ────────────────────────────────────────────────────────

export type TodayStatsLike = { sent: number; delivered: number; read: number; failed: number; waiting: number };

/** message_delivery: outbound today by where it got to (System Logs' own figures) + recent failures. */
export function summariseDelivery(today: TodayStatsLike, failed: Obj[], reasons: Map<string, string>, days: number, cap: number) {
  return {
    todayOutbound: {
      ...today,
      deliveredPct: today.sent ? Math.round((today.delivered / today.sent) * 1000) / 10 : null,
    },
    failed: {
      days,
      count: failed.length >= cap ? `${cap}+` : failed.length,
      byReason: tally(failed, (r) => reasons.get(str(r.id)) || str(r.sendError) || "(no reason recorded)"),
      latest: failed.slice(0, 10).map((r) => ({
        at: r.createdAt,
        conversationId: r.conversationId,
        customer: r.customer,
        type: r.type,
        reason: reasons.get(str(r.id)) || str(r.sendError) || null,
      })),
    },
    note: "Failed = WhatsApp did not deliver the message (Meta's reason when it sent one). Waiting = still queued to send.",
  };
}

// ── contacts_summary / campaign_summary ────────────────────────────────────

/** campaign_summary from /campaigns rows (each with its stats JSON). */
export function summariseCampaigns(rows: Obj[]) {
  let sent = 0;
  let failed = 0;
  let audience = 0;
  for (const c of rows) {
    const s = obj(c.stats);
    sent += num(s.sent);
    failed += num(s.failed);
    audience += num(s.total);
  }
  return {
    campaigns: rows.length,
    byStatus: tally(rows, (c) => str(c.status)),
    totals: { audience, sent, failed },
    latest: rows.slice(0, 10).map((c) => {
      const s = obj(c.stats);
      return { ...(c.id ? { id: c.id } : {}), name: c.name, template: c.template, status: c.status, scheduledAt: c.scheduleAt ?? null, audience: num(s.total) || null, sent: num(s.sent) || null, failed: num(s.failed) || null, createdAt: c.createdAt };
    }),
  };
}

// ── customer_mood_scan ──────────────────────────────────────────────────────

/** Owner 2026-11-26: supervisors and admins only — Connect's admin roles and MANAGER. */
export const MOOD_SCAN_ROLES = ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"];
export const MOOD_SCAN_REFUSAL = "Supervisors and admins only: customer_mood_scan is for managers and admins in Houzs Connect.";

export function moodScanAllowed(role: string | null | undefined): boolean {
  return MOOD_SCAN_ROLES.includes(String(role ?? ""));
}

export const MOOD_MAX_MESSAGES = 200;
export const MOOD_TEXT_CHARS = 300;
export const MOOD_MAX_DAYS = 7;

/** Words that often mean an unhappy customer (English, Malay, Chinese). Hints only. */
export const MOOD_KEYWORDS = [
  "refund", "cancel", "complain", "complaint", "angry", "disappointed", "worst", "terrible", "useless", "scam", "cheat", "lawyer", "police",
  "still waiting", "no reply", "nobody", "late", "delay", "broken", "damaged", "defect", "wrong", "rude", "unprofessional", "never again",
  "kecewa", "lambat", "rosak", "batal", "tipu", "marah",
  "退款", "投诉", "生气", "失望", "还没", "坏", "骗", "太慢", "退货", "差评",
];

export function keywordHints(text: string): string[] {
  const t = text.toLowerCase();
  return MOOD_KEYWORDS.filter((k) => t.includes(k));
}

/** A phone number with all but the last 4 digits hidden: 60•••••1234. */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length <= 4) return d ? "•".repeat(d.length) : "";
  return `${d.slice(0, 2)}${"•".repeat(Math.max(0, d.length - 6))}${d.slice(-4)}`;
}

export type MoodMessage = {
  conversationId: string;
  at: Date | string;
  text: string;
  type: string;
};

export type MoodConversation = {
  id: string;
  /** Contact name, or a masked phone when there is no name. */
  customer: string;
  status: string;
  assignedTo: string | null;
  department: string | null;
  channel: string | null;
  /** Newest outbound reply (any sender), if any. */
  lastReplyAt: Date | string | null;
  /** The newest message overall and who sent it. */
  lastMessageAt: Date | string | null;
  lastFromCustomer: boolean;
};

/**
 * Group the range's inbound messages by conversation for the AI to judge mood.
 * Most-active conversations first (more inbound messages, then newest), each
 * message clipped, at most MOOD_MAX_MESSAGES in all. Flags: messages since our
 * last reply (repeated without an answer), a wait longer than SLA_MINUTES, and
 * keyword hints.
 */
export function buildMoodScan(
  messages: MoodMessage[],
  convos: Map<string, MoodConversation>,
  range: { from: string; to: string },
  now: number = Date.now(),
  slaMinutes = SLA_MINUTES
) {
  const by = new Map<string, MoodMessage[]>();
  for (const m of messages) {
    if (!convos.has(m.conversationId)) continue;
    const list = by.get(m.conversationId) ?? [];
    list.push(m);
    by.set(m.conversationId, list);
  }
  const groups = [...by.entries()]
    .map(([id, list]) => ({ id, list: [...list].sort((a, b) => (msOf(a.at) ?? 0) - (msOf(b.at) ?? 0)) }))
    .sort((a, b) => b.list.length - a.list.length || (msOf(b.list[b.list.length - 1].at) ?? 0) - (msOf(a.list[a.list.length - 1].at) ?? 0));
  let budget = MOOD_MAX_MESSAGES;
  let shownMessages = 0;
  const out: Obj[] = [];
  for (const g of groups) {
    if (budget <= 0) break;
    const c = convos.get(g.id) as MoodConversation;
    const lastReply = msOf(c.lastReplyAt);
    const sinceReply = g.list.filter((m) => lastReply == null || (msOf(m.at) ?? 0) > lastReply).length;
    const lastAt = msOf(c.lastMessageAt);
    const waitingSec = c.lastFromCustomer && c.status !== "CLOSED" && lastAt != null ? Math.max(0, (now - lastAt) / 1000) : null;
    const keep = g.list.slice(-Math.min(budget, g.list.length)); // the newest of a busy conversation
    budget -= keep.length;
    shownMessages += keep.length;
    const hints = [...new Set(g.list.flatMap((m) => keywordHints(m.text ?? "")))];
    out.push({
      conversationId: g.id,
      customer: c.customer,
      assignedTo: c.assignedTo ?? "(unassigned)",
      department: c.department,
      channel: c.channel,
      status: c.status,
      inboundMessages: g.list.length,
      flags: {
        unansweredInARow: sinceReply,
        repeatedWithoutReply: sinceReply >= 2,
        waiting: waitingSec == null ? null : dur(waitingSec),
        overSla: waitingSec != null && waitingSec > slaMinutes * 60,
        keywordHints: hints,
      },
      messages: keep.map((m) => {
        const t = (m.text ?? "").replace(/\s+/g, " ").trim();
        return { at: m.at, text: t ? (t.length > MOOD_TEXT_CHARS ? t.slice(0, MOOD_TEXT_CHARS) + "…" : t) : `[${String(m.type).toLowerCase()}]` };
      }),
    });
  }
  return {
    range,
    conversations: by.size,
    conversationsShown: out.length,
    inboundMessages: messages.filter((m) => convos.has(m.conversationId)).length,
    messagesShown: shownMessages,
    slaMinutes,
    instructions:
      "Judge which customers are unhappy or complaining and summarise them: who, what about, how long they have waited, who has the conversation, and what to do next. Do not repeat the messages back in bulk. Keyword hints are only hints.",
    byConversation: out,
  };
}

// ── daily_brief ─────────────────────────────────────────────────────────────

export type BriefPart = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * daily_brief: what is this person's today in Connect. Each part is one
 * catalogue read as the person; a part they may not read says so.
 */
export function buildDailyBrief(
  parts: { overview: BriefPart; mine: BriefPart; payments: BriefPart; delivery: BriefPart },
  me: { name: string },
  origin: string
) {
  const section = <T,>(p: BriefPart, f: (v: unknown) => T): T | { unavailable: string } => (p.ok ? f(p.value) : { unavailable: p.message });
  const link = (id: unknown) => `${origin}/inbox/open/${encodeURIComponent(str(id))}`;
  return {
    myConversations: section(parts.mine, (v) => {
      const rows = arr(obj(v).conversations);
      const waiting = rows.filter((r) => r.waitingOnUs === true);
      return {
        assignedToMeNotClosed: rows.length >= 50 ? "50+" : rows.length,
        waitingForMyReply: waiting.length,
        unread: rows.filter((r) => num(r.unread) > 0).length,
        top: (waiting.length ? waiting : rows).slice(0, 5).map((r) => ({
          customer: r.customer,
          status: r.status,
          orderRef: r.orderRef ?? null,
          lastMessageAt: obj(r.lastMessage).at ?? null,
          waitingOnUs: r.waitingOnUs === true,
          url: link(r.id),
        })),
      };
    }),
    inbox: section(parts.overview, (v) => {
      const o = obj(v);
      const meRow = arr(o.byAgent).find((a) => str(a.name) === me.name);
      return {
        waitingForUs: o.waitingForUs,
        longestWait: o.longestWait,
        unassignedWaiting: num(arr(o.byAgent).find((a) => str(a.name) === "(unassigned)")?.waiting),
        mine: meRow ? { open: meRow.open, waiting: meRow.waiting } : { open: 0, waiting: 0 },
        longestWaiting: arr(o.longestWaiting).slice(0, 5).map((w) => ({ ...w, url: link(w.id) })),
        today: o.today,
      };
    }),
    paymentsToCheck: section(parts.payments, (v) => {
      const o = obj(v);
      return {
        pending: num(obj(o.countsByStatus).PENDING),
        top: arr(o.payments).slice(0, 5).map((p) => ({ customer: p.customer, amountRM: p.amount, orderRef: p.orderRef ?? null, at: p.createdAt })),
      };
    }),
    failedMessages: section(parts.delivery, (v) => {
      const o = obj(v);
      return { today: obj(o.todayOutbound), failedLast24h: obj(o.failed).count, latest: arr(obj(o.failed).latest).slice(0, 5) };
    }),
    note: "Only what this person can see in Houzs Connect. Times are Malaysia time.",
  };
}

// ── export_excel ────────────────────────────────────────────────────────────

export const EXPORT_ROW_CAP = 5000;
export const EXPORT_TTL_MS = 15 * 60 * 1000;

export type ExportColumn = { key: string; header: string; kind?: "text" | "number" | "money" | "date"; get?: (r: Obj) => unknown };

/**
 * The lists export_excel may read: a catalogue path, the rows key in its reply,
 * the page size it accepts, and the columns. No column carries message text
 * (customer messages are never exported in bulk); phone numbers appear only
 * where the list on screen shows them.
 */
export const EXPORT_LISTS: Record<string, { path: string; rowsKey: string; page: number; title: string; columns: ExportColumn[]; filters: string[] }> = {
  conversations: {
    path: "/conversations",
    rowsKey: "conversations",
    page: 100,
    title: "Conversations",
    filters: ["q", "status", "unread", "assigned"],
    columns: [
      { key: "customer", header: "Customer" },
      { key: "phone", header: "Phone" },
      { key: "status", header: "Status" },
      { key: "assignedTo", header: "Assigned to" },
      { key: "department", header: "Department" },
      { key: "tags", header: "Tags" },
      { key: "orderRef", header: "Order ref" },
      { key: "deliveryDate", header: "Delivery date" },
      { key: "unread", header: "Unread", kind: "number" },
      { key: "waitingOnUs", header: "Waiting on us", get: (r) => (r.waitingOnUs ? "yes" : "no") },
      { key: "lastMessageAt", header: "Last message (MYT)", kind: "date", get: (r) => obj(r.lastMessage).at },
    ],
  },
  contacts: {
    path: "/contacts",
    rowsKey: "contacts",
    page: 100,
    title: "Contacts",
    filters: ["q", "segment", "tag"],
    columns: [
      { key: "name", header: "Name" },
      { key: "phone", header: "Phone" },
      { key: "email", header: "Email" },
      { key: "source", header: "Source" },
      { key: "tags", header: "Tags" },
      { key: "orderRef", header: "Order ref", get: (r) => obj(r.fields).ref_1 },
      { key: "blocked", header: "Blocked", get: (r) => (r.blocked ? "yes" : "no") },
      { key: "updatedAt", header: "Updated (MYT)", kind: "date" },
    ],
  },
  payments: {
    path: "/payments",
    rowsKey: "payments",
    page: 100,
    title: "Payments",
    filters: ["q", "status"],
    columns: [
      { key: "createdAt", header: "Received (MYT)", kind: "date" },
      { key: "customer", header: "Customer" },
      { key: "phone", header: "Phone" },
      { key: "amount", header: "Amount (RM)", kind: "money" },
      { key: "currency", header: "Currency" },
      { key: "method", header: "Method" },
      { key: "referenceNo", header: "Reference no" },
      { key: "orderRef", header: "Order ref" },
      { key: "status", header: "Status" },
    ],
  },
  logs: {
    path: "/logs/messages",
    rowsKey: "messages",
    page: 200,
    title: "Message log",
    filters: ["q", "status", "direction", "days"],
    columns: [
      { key: "at", header: "Time (MYT)", kind: "date" },
      { key: "customer", header: "Customer" },
      { key: "phone", header: "Phone" },
      { key: "direction", header: "Direction" },
      { key: "type", header: "Type" },
      { key: "status", header: "Status" },
      { key: "sendError", header: "Send error" },
    ],
  },
  campaigns: {
    path: "/campaigns",
    rowsKey: "campaigns",
    page: 100,
    title: "Campaigns",
    filters: [],
    columns: [
      { key: "name", header: "Campaign" },
      { key: "template", header: "Template" },
      { key: "status", header: "Status" },
      { key: "scheduleAt", header: "Scheduled (MYT)", kind: "date" },
      { key: "audience", header: "Audience", kind: "number", get: (r) => obj(r.stats).total },
      { key: "sent", header: "Sent", kind: "number", get: (r) => obj(r.stats).sent },
      { key: "failed", header: "Failed", kind: "number", get: (r) => obj(r.stats).failed },
      { key: "createdAt", header: "Created (MYT)", kind: "date" },
    ],
  },
};

/** The chosen columns (by key or header, any case), in list order; all when none match. */
export function pickColumns(all: ExportColumn[], fields: unknown): ExportColumn[] {
  const want = Array.isArray(fields) ? (fields as unknown[]).map((f) => str(f).trim().toLowerCase()).filter(Boolean) : [];
  if (!want.length) return all;
  const picked = all.filter((c) => want.includes(c.key.toLowerCase()) || want.includes(c.header.toLowerCase()));
  return picked.length ? picked : all;
}

/** Rows flattened to the columns' keys (each column's `get` or its key). */
export function exportRows(rows: Obj[], columns: ExportColumn[]): Obj[] {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.get ? c.get(r) : r[c.key]])));
}

export function exportFileName(list: string, day: string): string {
  return `connect-${list.replace(/[^a-z0-9-]/gi, "")}-${day}.xlsx`;
}

// ── rate limit ──────────────────────────────────────────────────────────────

/** Per person (by email), tool calls only. Mutable only so the DB smoke can exercise it. */
export const RATE_LIMITS = { perMinute: 30, perDay: 600 };

export function rateLimitMessage(counts: { minute: number; day: number }, limits = RATE_LIMITS): string | null {
  if (counts.day >= limits.perDay) return `Daily limit reached: ${limits.perDay} AI Connector lookups in 24 hours. Try again later.`;
  if (counts.minute >= limits.perMinute) return `Too many requests — wait a minute (limit ${limits.perMinute} lookups a minute).`;
  return null;
}

// ── the daily-brief prompt ──────────────────────────────────────────────────

export const DAILY_BRIEF_PROMPT = {
  name: "daily-brief",
  title: "What do I need to look at today?",
  description: "Conversations waiting for your reply, the inbox's longest waits, payment slips to check and failed messages.",
  arguments: [] as { name: string; description: string; required: boolean }[],
};

export const DAILY_BRIEF_TEXT =
  "What do I need to look at today? Use daily_brief. Start with conversations waiting for my reply (longest first, with links), then the inbox's longest waits, payment slips to check and failed messages. For reply times use reply_speed. If a part says I do not have access, say so in one line.";

// AI Connector round 4 (owner 2026-11-26) — the pure parts: the `period`
// convention, waiting_now, agent_workload, customer_chat_summary, chat_review
// and data_gaps. No DB, no network, no Next. Pinned by scripts/smoke-mcp.mjs (CI).
//
// The reads behind them are catalogue endpoints in reads.ts (/inbox/waiting,
// /dashboard/agents, /inbox/chat-review, /contacts/gaps) or existing ones
// (/conversations, /conversations/:id, /inbox/overview), all run through
// server.ts readEndpoint: the person's modules, the inbox rail's visibility and
// the credential stripping apply. The only role rule is the owner's existing
// one for chat content — customer_chat_summary and chat_review use the SAME
// gate as customer_mood_scan (round3.moodScanAllowed).

import { SLA_MINUTES } from "@/lib/sla";
import { dur, pctChange } from "./quick";
import { keywordHints, maskPhone, myMidnight, myToday, shiftDay } from "./round3";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const msOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const clip = (s: unknown, n: number) => {
  const t = str(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};
const tally = (keys: string[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const k0 of keys) {
    const k = k0 || "(none)";
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A customer label for chat-content answers: the contact name, else a masked phone (as customer_mood_scan). */
export function customerLabel(name: string | null | undefined, phone: string | null | undefined): string {
  const t = (name ?? "").trim();
  return t && !/^\+?[\d\s-]+$/.test(t) ? t : maskPhone(phone);
}

/**
 * Chat-content tools (customer_chat_summary, chat_review) use customer_mood_scan's
 * gate — round3.moodScanAllowed: SUPER_ADMIN, OWNER, ADMIN, MANAGER. Same wording.
 */
export const chatContentRefusal = (tool: string) => `Supervisors and admins only: ${tool} is for managers and admins in Houzs Connect.`;

/** The inbox link of a conversation. */
export const conversationUrl = (origin: string, id: unknown) => `${origin}/inbox/open/${encodeURIComponent(str(id))}`;

/**
 * Add `url` (the inbox link) next to every `conversationId` in a reply, at any
 * depth. Endpoints do not know the public address; the tool layer does.
 */
export function addConversationLinks(v: unknown, origin: string, depth = 0): unknown {
  if (depth > 8 || !origin) return v;
  if (Array.isArray(v)) return v.map((x) => addConversationLinks(x, origin, depth + 1));
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) out[k] = addConversationLinks(x, origin, depth + 1);
    if (typeof out.conversationId === "string" && out.url === undefined) out.url = conversationUrl(origin, out.conversationId);
    return out;
  }
  return v;
}

// ── the `period` convention ─────────────────────────────────────────────────

export const PERIODS = ["today", "week", "month", "last_month", "quarter", "year", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export type PeriodRange = {
  period: Period;
  /** Malaysia days, inclusive. */
  from: string;
  to: string;
  /** [start, end) instants; end is now for a period still running. */
  start: Date;
  end: Date;
  previous: { from: string; to: string; start: Date; end: Date };
  label: string;
};

/** First day of the month `n` months after the month of a YYYY-MM-DD. */
function monthStart(day: string, n = 0): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/** The Malaysia day an instant falls on. */
const dayOf = (t: number) => myToday(t);
/** The last Malaysia day of [start, end): the day of end − 1 ms. */
const lastDay = (end: number) => dayOf(end - 1);

/**
 * The owner's period convention (2026-11-26), Malaysia calendar:
 * - today: midnight → now; previous = yesterday up to the same time.
 * - week: Monday → now; previous = last Monday up to the same weekday and time.
 * - month / quarter / year: the 1st → now; previous = the period before, the same
 *   length of time in (never past its own end).
 * - last_month: the whole of last month; previous = the month before it.
 * - custom: from..to (inclusive days, at most `maxDays`); previous = the same
 *   number of days just before.
 */
export function periodRange(periodRaw: unknown, fromRaw: unknown, toRaw: unknown, now: number = Date.now(), maxDays = 366): PeriodRange | { error: string } {
  const p = (str(periodRaw).trim().toLowerCase() || (str(fromRaw).trim() ? "custom" : "today")) as Period;
  if (!PERIODS.includes(p)) return { error: `period must be one of: ${PERIODS.join(", ")}.` };
  const today = myToday(now);
  const make = (startDay: string, endMs: number, prevStartDay: string, prevEndCap: number | null, label: string): PeriodRange => {
    const start = myMidnight(startDay).getTime();
    const prevStart = myMidnight(prevStartDay).getTime();
    const prevEnd = prevEndCap ?? Math.min(prevStart + (endMs - start), start);
    return {
      period: p,
      from: startDay,
      to: lastDay(endMs),
      start: new Date(start),
      end: new Date(endMs),
      previous: { from: prevStartDay, to: lastDay(prevEnd), start: new Date(prevStart), end: new Date(prevEnd) },
      label,
    };
  };
  switch (p) {
    case "today":
      return make(today, now, shiftDay(today, -1), null, "today (Malaysia time)");
    case "week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      const monday = shiftDay(today, -((dow + 6) % 7));
      return make(monday, now, shiftDay(monday, -7), null, "this week (Monday to now)");
    }
    case "month":
      return make(monthStart(today), now, monthStart(today, -1), null, "this month to date");
    case "last_month": {
      const s = monthStart(today, -1);
      return make(s, myMidnight(monthStart(today)).getTime(), monthStart(today, -2), myMidnight(s).getTime(), "last month");
    }
    case "quarter": {
      const m = Number(today.slice(5, 7)) - 1;
      const qs = monthStart(`${today.slice(0, 4)}-${String(m - (m % 3) + 1).padStart(2, "0")}-01`);
      return make(qs, now, monthStart(qs, -3), null, "this quarter to date");
    }
    case "year": {
      const ys = `${today.slice(0, 4)}-01-01`;
      return make(ys, now, monthStart(ys, -12), null, "this year to date");
    }
    case "custom": {
      const from = str(fromRaw).trim();
      let to = str(toRaw).trim() || today;
      if (!YMD.test(from) || !YMD.test(to)) return { error: "For a custom period give from and to as YYYY-MM-DD." };
      if (to > today) to = today;
      if (from > to) return { error: "from must be on or before to, and not in the future." };
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
      if (days > maxDays) return { error: `At most ${maxDays} days at a time.` };
      const end = Math.min(myMidnight(shiftDay(to, 1)).getTime(), now);
      const prevStartDay = shiftDay(from, -days);
      return make(from, end, prevStartDay, myMidnight(from).getTime(), `${from} to ${to}`);
    }
  }
}

/** The period input every period-type tool takes. */
export const PERIOD_SCHEMA = {
  period: { type: "string", enum: [...PERIODS], description: "today (default) | week = Monday to now | month | last_month | quarter | year | custom (with from / to). Compared with the previous period (last week to the same weekday, and so on)." },
  from: { type: "string", description: "YYYY-MM-DD, for period=custom" },
  to: { type: "string", description: "YYYY-MM-DD, for period=custom (default today)" },
};

export const periodOut = (r: PeriodRange) => ({ period: r.period, label: r.label, from: r.from, to: r.to, previous: { from: r.previous.from, to: r.previous.to } });

// ── W1 waiting_now ──────────────────────────────────────────────────────────

export type WaitingNowRow = {
  id: string;
  customer: string;
  status: string;
  assignedTo: string | null;
  department: string | null;
  channel: string | null;
  /** The first customer message after our last reply — when the wait began. */
  waitingSince: Date | string | null;
  /** Customer messages since our last reply. */
  unanswered: number;
  lastMessage: string;
};

/** waiting_now: every conversation (in the person's inbox visibility) whose newest message is the customer's, longest wait first. */
export function summariseWaitingNow(rows: WaitingNowRow[], total: number, now: number = Date.now(), slaMinutes = SLA_MINUTES) {
  const waits = rows.map((r) => {
    const since = msOf(r.waitingSince);
    const sec = since == null ? null : Math.max(0, (now - since) / 1000);
    return { r, sec };
  });
  const over = waits.filter((w) => w.sec != null && w.sec > slaMinutes * 60).length;
  return {
    waitingNow: total,
    overSla: rows.length < total ? `${over}+` : over,
    slaMinutes,
    unassigned: rows.length < total ? `${rows.filter((r) => !r.assignedTo).length}+` : rows.filter((r) => !r.assignedTo).length,
    byAssignee: tally(rows.map((r) => r.assignedTo ?? "(unassigned)")),
    longestFirst: waits.map(({ r, sec }) => ({
      conversationId: r.id,
      customer: r.customer,
      waiting: dur(sec),
      waitingSince: r.waitingSince,
      overSla: sec != null && sec > slaMinutes * 60,
      unansweredMessages: r.unanswered,
      assignedTo: r.assignedTo ?? "(unassigned)",
      department: r.department,
      channel: r.channel,
      status: r.status,
      lastMessage: r.lastMessage || null,
    })),
    ...(rows.length < total ? { note: `Showing the ${rows.length} longest waits of ${total}.` } : {}),
    timing: "Waiting = not closed and the customer wrote last; measured from the customer's first message after our last reply (clock time).",
  };
}

// ── W2 agent_workload ───────────────────────────────────────────────────────

export type AgentReportRow = { id: string; name: string; dept: string | null; assigned: number; open: number; closed: number; replied: number; first: number | null; onTime: boolean | null; avg: number | null };
export type ReplyTotals = { asked: number; answered: number; answeredHuman: number; avgFirst: number | null; avgReply: number | null; businessHours: boolean };
export type OpenNowRow = { agentId: string | null; open: number; waiting: number };

/**
 * agent_workload: the Dashboard's own agents report for the period (who
 * replied, how many, first reply / reply times, on time vs the SLA), the
 * team's reply figures vs the previous period, and each person's open and
 * waiting chats right now (company-wide, like the Dashboard's live panel).
 */
export function summariseAgentWorkload(range: PeriodRange, list: AgentReportRow[], team: ReplyTotals, prev: ReplyTotals, openNow: OpenNowRow[], names: Map<string, string>, slaMinutes = SLA_MINUTES) {
  const open = new Map(openNow.filter((o) => o.agentId).map((o) => [o.agentId as string, o]));
  const unassigned = openNow.find((o) => !o.agentId);
  const seen = new Set<string>();
  const rows = list.map((a) => {
    seen.add(a.id);
    const o = open.get(a.id);
    return {
      name: a.name,
      department: a.dept,
      openNow: o?.open ?? 0,
      waitingNow: o?.waiting ?? 0,
      replies: a.replied,
      conversationsHandled: a.assigned,
      avgFirstReply: dur(a.first),
      avgReply: dur(a.avg),
      firstReplyOnTime: a.onTime,
    };
  });
  // People sitting on open chats who sent no reply in the period still count.
  for (const [id, o] of open) {
    if (seen.has(id)) continue;
    rows.push({ name: names.get(id) ?? "—", department: null, openNow: o.open, waitingNow: o.waiting, replies: 0, conversationsHandled: 0, avgFirstReply: null, avgReply: null, firstReplyOnTime: null });
  }
  rows.sort((a, b) => b.replies - a.replies || b.openNow - a.openNow || a.name.localeCompare(b.name));
  const window = (r: ReplyTotals) => ({
    customersWhoWrote: r.asked,
    answered: r.answered,
    replyRatePct: pct(r.answered, r.asked),
    answeredByAPerson: r.answeredHuman,
    avgFirstReply: dur(r.avgFirst),
    avgReply: dur(r.avgReply),
    avgFirstReplySeconds: r.avgFirst == null ? null : Math.round(r.avgFirst),
  });
  return {
    ...periodOut(range),
    timing: team.businessHours ? "business hours only" : "clock time",
    slaMinutes,
    team: window(team),
    previousPeriod: window(prev),
    change: {
      customersWhoWrotePct: pctChange(team.asked, prev.asked),
      avgFirstReplyPct: team.avgFirst == null || prev.avgFirst == null ? null : pctChange(team.avgFirst, prev.avgFirst),
    },
    byAgent: rows.slice(0, 30),
    unassignedNow: { open: unassigned?.open ?? 0, waiting: unassigned?.waiting ?? 0 },
    note: "Replies / reply times = the Dashboard's agents report (a reply is credited to whoever sent it; bots do not count). openNow / waitingNow = not-closed chats assigned to the person right now, company-wide.",
  };
}

// ── W3 customer_chat_summary ────────────────────────────────────────────────

export const CHAT_SUMMARY_MESSAGES = 40;
export const CHAT_TEXT_CHARS = 300;

/**
 * customer_chat_summary: one customer's recent conversation (the
 * /conversations/:id read as the person) made short for the AI to summarise —
 * no phone number, clipped messages, flags, and the other matches.
 */
export function summariseCustomerChat(thread: unknown, matches: Obj[], now: number = Date.now(), slaMinutes = SLA_MINUTES) {
  const t = obj(thread);
  const c = obj(t.customer);
  const fields = obj(c.fields);
  const msgs = arr(t.messages);
  const fromCustomer = msgs.filter((m) => m.from === "customer");
  let lastOurs = -1;
  msgs.forEach((m, i) => {
    if (m.from !== "customer") lastOurs = i;
  });
  const unanswered = msgs.slice(lastOurs + 1).filter((m) => m.from === "customer");
  const lastMsg = msgs[msgs.length - 1];
  const waitingSec = lastMsg && lastMsg.from === "customer" && t.status !== "CLOSED" && unanswered.length ? Math.max(0, (now - (msOf(unanswered[0].at) ?? now)) / 1000) : null;
  return {
    conversationId: str(t.id),
    customer: customerLabel(str(c.name), str(c.phone)),
    status: t.status,
    assignedTo: t.assignedTo ?? "(unassigned)",
    department: t.department ?? null,
    tags: t.tags,
    orderRef: fields.ref_1 ?? null,
    deliveryDate: fields.delivery_date_1 ?? null,
    flags: {
      unansweredInARow: unanswered.length,
      waiting: dur(waitingSec),
      overSla: waitingSec != null && waitingSec > slaMinutes * 60,
      keywordHints: [...new Set(fromCustomer.flatMap((m) => keywordHints(str(m.text))))],
    },
    messagesShown: msgs.length,
    fromCustomer: fromCustomer.length,
    fromUs: msgs.length - fromCustomer.length,
    messages: msgs.map((m) => ({ at: m.at, from: m.from, text: clip(m.text, CHAT_TEXT_CHARS) || `[${str(m.type).toLowerCase()}]` })),
    internalNotes: arr(t.internalNotes).slice(-5).map((n) => ({ at: n.at, by: n.by, text: clip(n.text, 200) })),
    otherMatches: matches.slice(0, 5).map((m) => ({ conversationId: str(m.id), customer: customerLabel(str(m.customer), str(m.phone)), status: m.status, assignedTo: m.assignedTo ?? null, lastMessageAt: obj(m.lastMessage).at ?? null })),
    instructions: "Summarise this customer's conversation: what they want, what we told them, what is still open, how long they have waited, and the next step. Do not paste the messages back.",
  };
}

// ── W4 chat_review ──────────────────────────────────────────────────────────

/** One message of the period, no text (the walk). */
export type WalkMessage = { conversationId: string; direction: string; isBot: boolean; at: Date | string; senderId: string | null };
export type ReviewConversation = {
  id: string;
  contactId: string;
  customer: string;
  status: string;
  assignedTo: string | null;
  department: string | null;
  /** Newest message overall (any time) is the customer's. */
  lastFromCustomer: boolean;
};
export type InboundText = { conversationId: string; at: Date | string; text: string };
export type LastReply = { conversationId: string; at: Date | string; text: string; senderId: string | null };

export const REVIEW_LIST = 20;
export const REVIEW_COMPLAINERS = 10;
export const REVIEW_WALK_CAP = 20_000;

type ConvoWalk = { firstIn: number | null; lastIn: number | null; lastHuman: number | null; firstHumanAfterIn: number | null; inbound: number; bot: number; unanswered: number; waitStart: number | null };

/** Walk a period's messages (ordered or not) into one line per conversation. */
export function walkConversations(msgs: WalkMessage[]): Map<string, ConvoWalk> {
  const sorted = [...msgs].sort((a, b) => (msOf(a.at) ?? 0) - (msOf(b.at) ?? 0));
  const by = new Map<string, ConvoWalk>();
  for (const m of sorted) {
    const at = msOf(m.at) ?? 0;
    const w = by.get(m.conversationId) ?? { firstIn: null, lastIn: null, lastHuman: null, firstHumanAfterIn: null, inbound: 0, bot: 0, unanswered: 0, waitStart: null };
    if (m.direction === "IN") {
      w.inbound++;
      if (w.unanswered === 0) w.waitStart = at;
      w.unanswered++;
      if (w.firstIn == null) w.firstIn = at;
      w.lastIn = at;
    } else if (m.isBot) {
      w.bot++;
    } else {
      w.lastHuman = at;
      w.unanswered = 0;
      w.waitStart = null;
      if (w.firstIn != null && w.firstHumanAfterIn == null) w.firstHumanAfterIn = at;
    }
    by.set(m.conversationId, w);
  }
  return by;
}

/** Counts of a period's walk: conversations where the customer wrote, replied (a person answered their latest message), not replied. */
function walkCounts(walk: Map<string, ConvoWalk>) {
  let wrote = 0;
  let replied = 0;
  for (const w of walk.values()) {
    if (w.lastIn == null) continue;
    wrote++;
    if (w.lastHuman != null && w.lastHuman > w.lastIn) replied++;
  }
  return { customersWhoWrote: wrote, replied, notReplied: wrote - replied, replyRatePct: pct(replied, wrote) };
}

/**
 * chat_review for a period (supervisors and admins): who wrote and was NOT
 * answered by a person (longest wait first), who WAS (with a short snippet of
 * our latest reply), customers who complain repeatedly (complaint keywords on
 * two or more days, or in three or more messages), and a quality view, against
 * the previous period. "Replied" = a person (not a bot) wrote after the
 * customer's latest message in the period.
 */
export function buildChatReview(
  range: PeriodRange,
  input: {
    walk: WalkMessage[];
    prevWalk: WalkMessage[];
    convos: Map<string, ReviewConversation>;
    inbound: InboundText[];
    lastReplies: LastReply[];
    names: Map<string, string>;
    truncated: boolean;
  },
  now: number = Date.now(),
  slaMinutes = SLA_MINUTES
) {
  const walk = walkConversations(input.walk);
  const prev = walkCounts(walkConversations(input.prevWalk));
  const replyBy = new Map(input.lastReplies.map((r) => [r.conversationId, r]));
  const lastInText = new Map<string, InboundText>();
  for (const m of input.inbound) {
    const cur = lastInText.get(m.conversationId);
    if (!cur || (msOf(m.at) ?? 0) > (msOf(cur.at) ?? 0)) lastInText.set(m.conversationId, m);
  }
  const notReplied: Obj[] = [];
  const replied: Obj[] = [];
  const firstReplies: number[] = [];
  let overSlaFirst = 0;
  let stillWaiting = 0;
  let unresolved = 0;
  let botOnly = 0;
  for (const [id, w] of walk) {
    const c = input.convos.get(id);
    if (!c || w.lastIn == null) continue;
    if (c.status !== "CLOSED") unresolved++;
    if (w.firstHumanAfterIn != null && w.firstIn != null) {
      const f = (w.firstHumanAfterIn - w.firstIn) / 1000;
      firstReplies.push(f);
      if (f > slaMinutes * 60) overSlaFirst++;
    }
    const answered = w.lastHuman != null && w.lastHuman > w.lastIn;
    if (!answered) {
      const waitingNow = c.lastFromCustomer && c.status !== "CLOSED";
      if (waitingNow) stillWaiting++;
      if (w.bot > 0) botOnly++;
      // The wait began at the first customer message after our last human reply in the period.
      const since = w.waitStart ?? w.lastIn;
      notReplied.push({
        conversationId: id,
        customer: c.customer,
        assignedTo: c.assignedTo ?? "(unassigned)",
        department: c.department,
        status: c.status,
        customerMessagesUnanswered: w.unanswered,
        lastCustomerMessageAt: new Date(w.lastIn).toISOString(),
        waitingNow,
        waiting: waitingNow ? dur(Math.max(0, (now - since) / 1000)) : null,
        onlyABotAnswered: w.bot > 0 && w.lastHuman == null,
        lastCustomerMessage: clip(lastInText.get(id)?.text, 120) || null,
        _sort: since,
      });
    } else {
      const r = replyBy.get(id);
      replied.push({
        conversationId: id,
        customer: c.customer,
        assignedTo: c.assignedTo ?? "(unassigned)",
        status: c.status,
        repliedBy: r ? (input.names.get(r.senderId ?? "") ?? "us") : null,
        firstReplyAfter: w.firstHumanAfterIn != null && w.firstIn != null ? dur((w.firstHumanAfterIn - w.firstIn) / 1000) : null,
        lastReplyAt: new Date(w.lastHuman as number).toISOString(),
        ourLastReply: r ? clip(r.text, 160) || "[media]" : null,
        _sort: w.lastHuman,
      });
    }
  }
  const strip = (rows: Obj[]) =>
    rows.map((r) => {
      const o = { ...r };
      delete o._sort;
      return o;
    });
  notReplied.sort((a, b) => num(a._sort) - num(b._sort));
  replied.sort((a, b) => num(b._sort) - num(a._sort));

  // Repeat complainers: per customer (contact), across their conversations.
  const people = new Map<string, { customer: string; convos: Set<string>; days: Set<string>; msgs: number; hints: Set<string>; samples: { at: string; text: string }[] }>();
  let negativeConvos = new Set<string>();
  for (const m of [...input.inbound].sort((a, b) => (msOf(a.at) ?? 0) - (msOf(b.at) ?? 0))) {
    const c = input.convos.get(m.conversationId);
    if (!c) continue;
    const hints = keywordHints(m.text ?? "");
    if (!hints.length) continue;
    negativeConvos.add(m.conversationId);
    const p = people.get(c.contactId) ?? { customer: c.customer, convos: new Set(), days: new Set(), msgs: 0, hints: new Set(), samples: [] };
    p.convos.add(m.conversationId);
    p.days.add(myToday(msOf(m.at) ?? 0));
    p.msgs++;
    for (const h of hints) p.hints.add(h);
    if (p.samples.length < 3) p.samples.push({ at: str(m.at), text: clip(m.text, 200) });
    people.set(c.contactId, p);
  }
  negativeConvos = new Set([...negativeConvos].filter((id) => walk.has(id)));
  const complainers = [...people.values()]
    .filter((p) => p.days.size >= 2 || p.msgs >= 3)
    .sort((a, b) => b.days.size - a.days.size || b.msgs - a.msgs)
    .map((p) => {
      const ids = [...p.convos];
      const c = input.convos.get(ids[0]);
      return {
        customer: p.customer,
        complaintMessages: p.msgs,
        onDays: p.days.size,
        keywordHints: [...p.hints],
        conversationId: ids[0],
        conversations: ids.length,
        assignedTo: c?.assignedTo ?? "(unassigned)",
        stillWaiting: ids.some((id) => {
          const cv = input.convos.get(id);
          return !!cv && cv.lastFromCustomer && cv.status !== "CLOSED";
        }),
        samples: p.samples,
      };
    });

  const cur = walkCounts(walk);
  const firstAvg = avg(firstReplies);
  return {
    ...periodOut(range),
    quality: {
      ...cur,
      avgFirstReplyAfter: dur(firstAvg),
      firstReplyOverSla: overSlaFirst,
      slaMinutes,
      stillWaitingNow: stillWaiting,
      unresolved,
      onlyABotAnswered: botOnly,
      negativeMood: negativeConvos.size,
      repeatComplainers: complainers.length,
    },
    previousPeriod: prev,
    change: {
      customersWhoWrotePct: pctChange(cur.customersWhoWrote, prev.customersWhoWrote),
      notRepliedPct: pctChange(cur.notReplied, prev.notReplied),
      replyRatePoints: cur.replyRatePct == null || prev.replyRatePct == null ? null : Math.round((cur.replyRatePct - prev.replyRatePct) * 10) / 10,
    },
    notReplied: { count: notReplied.length, longestFirst: strip(notReplied.slice(0, REVIEW_LIST)) },
    repeatComplainers: complainers.slice(0, REVIEW_COMPLAINERS),
    replied: { count: replied.length, latestFirst: strip(replied.slice(0, REVIEW_LIST)) },
    ...(input.truncated ? { truncated: `More than ${REVIEW_WALK_CAP} messages in the period — figures cover the first ${REVIEW_WALK_CAP}; pick a shorter period for exact numbers.` } : {}),
    definitions:
      "Replied = a person (not a bot) wrote after the customer's latest message in the period. Not replied = the customer's latest message has no reply from a person. Unresolved = not closed. Negative mood = complaint keywords (EN / Malay / Chinese — hints only). Repeat complainer = complaint keywords on 2+ days or in 3+ messages. firstReplyAfter is clock time; reply times in business hours are in replyTimes (the Dashboard's measurement).",
    instructions: "Summarise for a supervisor: who has not been answered (longest first), who was and what we said, which customers keep complaining and about what, and the quality vs the previous period. Do not paste the messages back.",
  };
}

// ── D4 data_gaps ────────────────────────────────────────────────────────────

export type GapPart = { ok: true; value: unknown } | { ok: false; message: string };

/** data_gaps: contacts with no name / no or malformed phone, and not-closed conversations with no one assigned. */
export function buildDataGaps(parts: { contacts: GapPart; overview: GapPart; unassigned: GapPart }) {
  const section = <T,>(p: GapPart, f: (v: unknown) => T): T | { unavailable: string } => (p.ok ? f(p.value) : { unavailable: p.message });
  return {
    contacts: section(parts.contacts, (v) => v),
    conversations: section(parts.overview, (v) => {
      const o = obj(v);
      const u = arr(o.byAgent).find((a) => str(a.name) === "(unassigned)");
      return {
        notClosed: o.notClosed,
        noAgentAssigned: num(u?.open),
        noAgentAssignedAndWaiting: num(u?.waiting),
        examples: parts.unassigned.ok
          ? arr(obj(parts.unassigned.value).conversations).slice(0, 10).map((c) => ({
              conversationId: str(c.id),
              customer: c.customer,
              status: c.status,
              department: c.department ?? "(no department)",
              waitingOnUs: c.waitingOnUs === true,
              lastMessageAt: obj(c.lastMessage).at ?? null,
            }))
          : [],
      };
    }),
    note: "Gaps in what this person can see: contacts in this company, conversations in their inbox visibility.",
  };
}

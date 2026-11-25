// AI Connector quick answers, search / fetch and prompts — the pure parts.
// No DB, no network, no Next. Pinned by scripts/smoke-mcp.mjs (CI).
//
// Owner 2026-11-25: searching through the connector felt slow. The AI walked
// list_modules → list_endpoints → connect_get and read replies of 15–48k
// characters to answer "how is the inbox today?". A quick answer is ONE tool
// call that runs a few aggregate queries as the person (reads.ts) and returns a
// summary of a few hundred characters. Same idea as Hookka ERP PR #1615, adapted:
// Connect's connector already runs a fixed catalogue of read functions, so the
// quick answers are two more of those, not wrappers around inner HTTP calls.

import { humanDuration } from "@/app/(app)/dashboard/util";

/** Percent change, 1 dp; null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/** Seconds → "4m 12s", or null. */
export function dur(seconds: number | null | undefined): string | null {
  return seconds == null || !Number.isFinite(seconds) ? null : humanDuration(seconds);
}

// ── inbox overview ─────────────────────────────────────────────────────────

/** One group of NOT-closed conversations the person can see (reads.ts inboxOverview). */
export type InboxGroupRow = {
  status: string;
  channel: string | null;
  agent: string | null;
  n: number;
  unread: number;
  /** Last message is from the customer — the ball is in our court. */
  waiting: number;
  /** lastMessageAt of the longest-waiting conversation in the group. */
  oldestWaitingAt: Date | string | null;
};

export type InboxTotals = {
  messagesInToday: number;
  messagesOutToday: number;
  messagesIn7d: number;
  messagesOut7d: number;
  newConversationsToday: number;
  newConversations7d: number;
  /** null when the person does not have the contacts module. */
  contactsAddedToday: number | null;
  contactsAdded7d: number | null;
};

export type WaitingRow = { id: string; customer: string; assignedTo: string | null; channel: string | null; since: Date | string | null };

const ms = (d: Date | string | null | undefined): number | null => {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

type Bucket = { name: string; open: number; waiting: number; unread: number };

function bucketsBy(rows: InboxGroupRow[], key: "channel" | "agent", empty: string, top = 10): Bucket[] {
  const by = new Map<string, Bucket>();
  for (const r of rows) {
    const name = r[key] || empty;
    const b = by.get(name) ?? { name, open: 0, waiting: 0, unread: 0 };
    b.open += r.n;
    b.waiting += r.waiting;
    b.unread += r.unread;
    by.set(name, b);
  }
  return [...by.values()].sort((a, b) => b.waiting - a.waiting || b.open - a.open).slice(0, top);
}

/** The inbox overview reply: small, already summed, names not ids. */
export function summariseInbox(rows: InboxGroupRow[], totals: InboxTotals, waiting: WaitingRow[], now: number = Date.now()) {
  const byStatus: Record<string, number> = {};
  let open = 0;
  let waitingN = 0;
  let unread = 0;
  let oldest: number | null = null;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    open += r.n;
    waitingN += r.waiting;
    unread += r.unread;
    const t = ms(r.oldestWaitingAt);
    if (t != null && (oldest == null || t < oldest)) oldest = t;
  }
  const ago = (t: number | null) => (t == null ? null : humanDuration(Math.max(0, (now - t) / 1000)));
  return {
    scope: "Conversations this person can see in Service (same rule as their inbox). Times are Malaysia time.",
    notClosed: open,
    byStatus,
    waitingForUs: waitingN,
    withUnread: unread,
    longestWait: ago(oldest),
    byChannel: bucketsBy(rows, "channel", "(no channel)"),
    byAgent: bucketsBy(rows, "agent", "(unassigned)"),
    today: {
      messagesIn: totals.messagesInToday,
      messagesOut: totals.messagesOutToday,
      newConversations: totals.newConversationsToday,
      ...(totals.contactsAddedToday == null ? {} : { contactsAdded: totals.contactsAddedToday }),
    },
    last7Days: {
      messagesIn: totals.messagesIn7d,
      messagesOut: totals.messagesOut7d,
      newConversations: totals.newConversations7d,
      ...(totals.contactsAdded7d == null ? {} : { contactsAdded: totals.contactsAdded7d }),
    },
    longestWaiting: waiting.map((w) => ({
      id: w.id,
      customer: w.customer,
      assignedTo: w.assignedTo ?? "(unassigned)",
      channel: w.channel,
      waiting: ago(ms(w.since)),
    })),
  };
}

// ── service performance (response times) ──────────────────────────────────

export type ReplyLike = {
  asked: number;
  answered: number;
  answeredHuman: number;
  avgFirst: number | null;
  avgReply: number | null;
  businessHours: boolean;
  byAgent: Map<string, { first: number[]; all: number[] }>;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The dashboard's reply / status / volume figures for a period, summarised. */
export function summariseService(
  period: { days: number; label: string },
  reply: ReplyLike,
  status: { total: number; by: Record<string, number> },
  volume: { total: { inbound: number; outbound: number }; prev: { inbound: number; outbound: number } },
  names: Map<string, string>
) {
  const people = [...reply.byAgent.entries()]
    .map(([id, v]) => ({ name: names.get(id) ?? "—", replies: v.all.length, avgReply: dur(avg(v.all)), avgFirstReply: dur(avg(v.first)) }))
    .sort((a, b) => b.replies - a.replies)
    .slice(0, 10);
  return {
    period: `${period.label} (${period.days} days)`,
    replies: {
      customersWhoWrote: reply.asked,
      answered: reply.answered,
      replyRatePct: reply.asked ? Math.round((reply.answered / reply.asked) * 1000) / 10 : null,
      answeredByAPerson: reply.answeredHuman,
      avgFirstReply: dur(reply.avgFirst),
      avgReply: dur(reply.avgReply),
      timing: reply.businessHours ? "business hours only" : "clock time",
    },
    byPerson: people,
    conversationsActive: status.total,
    conversationsByStatus: status.by,
    messages: {
      in: volume.total.inbound,
      out: volume.total.outbound,
      previousPeriod: { in: volume.prev.inbound, out: volume.prev.outbound },
      changePct: pctChange(volume.total.inbound + volume.total.outbound, volume.prev.inbound + volume.prev.outbound),
    },
  };
}

// ── search / fetch (the shape ChatGPT requires) ────────────────────────────
// https://developers.openai.com/api/docs/mcp — search returns one text item
// holding {"results":[{"id","title","url"}]}; fetch returns one text item holding
// {"id","title","text","url","metadata"}.

export const FETCH_KINDS = ["conversation", "contact"] as const;
export type FetchKind = (typeof FETCH_KINDS)[number];

/** "conversation:abc" / "contact:abc" → its parts; anything else → null. */
export function parseFetchId(raw: unknown): { kind: FetchKind; rowId: string } | null {
  const m = /^(conversation|contact):([A-Za-z0-9_-]{1,64})$/.exec(String(raw ?? "").trim());
  return m ? { kind: m[1] as FetchKind, rowId: m[2] } : null;
}

/** The page a person opens for a search result (rail links through /inbox/open to switch company). */
export function recordUrl(origin: string, kind: FetchKind, rowId: string): string {
  return kind === "conversation" ? `${origin}/inbox/open/${encodeURIComponent(rowId)}` : `${origin}/contacts?id=${encodeURIComponent(rowId)}`;
}

export type SearchResult = { id: string; title: string; url: string };

/** Exactly {id, title, url} — nothing else rides along. */
export function searchResult(origin: string, kind: FetchKind, rowId: string, title: string): SearchResult {
  return { id: `${kind}:${rowId}`, title: title.replace(/\s+/g, " ").trim().slice(0, 200), url: recordUrl(origin, kind, rowId) };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const str = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
const when = (v: unknown): string => str(v).replace("T", " ").slice(0, 16);

/** A conversation (reads.ts /conversations/:id) as readable text for fetch. */
export function conversationDoc(c: unknown): { title: string; text: string; metadata: Obj } {
  const d = obj(c);
  const cust = obj(d.customer);
  const fields = Object.entries(obj(cust.fields)).filter(([, v]) => v != null && v !== "");
  const lines = [
    `Customer: ${str(cust.name)}${cust.phone ? ` (${str(cust.phone)})` : ""}`,
    `Status: ${str(d.status)} · Assigned to: ${str(d.assignedTo) || "(unassigned)"}${d.department ? ` · Department: ${str(d.department)}` : ""}`,
  ];
  const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map(str).filter(Boolean) : [];
  if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
  if (fields.length) lines.push(`Customer fields: ${fields.map(([k, v]) => `${k}: ${str(v)}`).join("; ")}`);
  lines.push("", "Messages (oldest first):");
  for (const m of arr(d.messages)) lines.push(`[${when(m.at)}] ${str(m.from)}: ${str(m.text)}`);
  const notes = arr(d.internalNotes);
  if (notes.length) {
    lines.push("", "Internal notes:");
    for (const n of notes) lines.push(`[${when(n.at)}] ${str(n.by)}: ${str(n.text)}`);
  }
  return {
    title: `Conversation with ${str(cust.name) || "customer"}`,
    text: lines.join("\n"),
    metadata: { type: "conversation", status: str(d.status), assignedTo: str(d.assignedTo) || null, customerId: str(cust.id) || null },
  };
}

/** A contact (reads.ts /contacts/:id) as readable text for fetch. */
export function contactDoc(c: unknown): { title: string; text: string; metadata: Obj } {
  const d = obj(c);
  const fields = Object.entries(obj(d.fields)).filter(([, v]) => v != null && v !== "");
  const lines = [`Name: ${str(d.name)}`, `Phone: ${str(d.phone)}`];
  if (d.email) lines.push(`Email: ${str(d.email)}`);
  if (d.source) lines.push(`Source: ${str(d.source)}`);
  const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).map(str).filter(Boolean) : [];
  if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
  if (d.blocked) lines.push("Blocked: yes");
  for (const [k, v] of fields) lines.push(`${k}: ${str(v)}`);
  const convos = arr(d.recentConversations);
  if (convos.length) {
    lines.push("", "Recent conversations:");
    for (const v of convos) lines.push(`- conversation:${str(v.id)} · ${str(v.status)} · ${when(v.lastMessageAt)} · ${str(v.lastMessage)}`);
  }
  return {
    title: `Contact ${str(d.name)}`,
    text: lines.join("\n"),
    metadata: { type: "contact", createdAt: str(d.createdAt) || null, updatedAt: str(d.updatedAt) || null },
  };
}

// ── prompts (ready-made questions shown in the AI app) ─────────────────────

export const PROMPTS = [
  {
    name: "inbox_today",
    title: "How is the inbox today?",
    description: "Open and unanswered conversations by channel and by person, the longest waits, and today's message volume.",
    arguments: [],
  },
  {
    name: "service_review",
    title: "Service review",
    description: "Reply rate and response times for a period, by person, with message volume against the period before.",
    arguments: [{ name: "days", description: "7, 30 or 90 (default 7)", required: false }],
  },
  {
    name: "find_customer",
    title: "Find a customer",
    description: "Find a customer or conversation by name, phone or order number and summarise it.",
    arguments: [{ name: "who", description: "Customer name, phone or order number", required: true }],
  },
];

/** The message a prompt expands to (prompts/get). Unknown name → null. */
export function promptText(name: string, a: Record<string, unknown>): string | null {
  const v = (k: string) => (typeof a[k] === "string" || typeof a[k] === "number" ? String(a[k]).trim().slice(0, 100) : "");
  if (name === "inbox_today") {
    return "Using inbox_overview, tell me how the Service inbox looks right now: how many conversations are open and how many are waiting for our reply, by channel and by person, who has waited longest, and today's message volume. Short, plain language.";
  }
  if (name === "service_review") {
    const days = ["7", "30", "90"].includes(v("days")) ? v("days") : "7";
    return `Using service_performance with days=${days}, review our customer service: reply rate, average first reply and reply times, who replied most and fastest, and message volume against the period before. Point out anything that needs attention. Short, plain language.`;
  }
  if (name === "find_customer") {
    return `Find "${v("who")}" with search, open the best match with fetch, and summarise it: the customer, order fields, conversation status, who it is assigned to, and the latest messages. Give the link.`;
  }
  return null;
}

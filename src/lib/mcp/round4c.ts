// AI Connector round 4c — platform quality (owner 2026-11-26, from the
// open-source survey). Pure, pinned by scripts/smoke-mcp-actions.mjs.
//
//   P1 role-aware tools/list  A tool is listed only when the person can use it:
//                             its module (Settings → Access; `module` /
//                             `anyModule` on the TOOLS entry), the supervisor
//                             gate for chat content, and — for the write
//                             actions — the admin's switches. A hidden tool
//                             called directly still answers "no access"
//                             (server.ts callTool asks the same questions).
//   P2 prompts per role       ROLE_PROMPTS: supervisor morning, my queue, weekly
//                             quality review; a prompt shows when its tool does.
//   P3 structured output      STRUCTURED_TOOLS carry an open `outputSchema`;
//                             their answers carry `structuredContent` (the text
//                             keeps the same JSON).
//   P4 speed                  AnswerCache: heavy summaries reused for 60 s per
//                             person + role + modules + arguments, in this
//                             isolate only; cleared for the person after any
//                             confirmed action. Gates run BEFORE the cache.
//   P5 links                  withLinks: a top-level `link` to the Connect page
//                             each answer comes from, and a `url` on every row
//                             that names a conversation, contact or campaign.

import type { Module } from "@/lib/module-access";
import { conversationUrl } from "./round4";

type Obj = Record<string, unknown>;

// ── P2: prompts per role ────────────────────────────────────────────────────

export const ROLE_PROMPTS = [
  {
    name: "supervisor_morning",
    title: "Supervisor morning check",
    description: "Supervisors and admins: who is waiting for a reply right now, and how yesterday's chats went (not replied, complaints, reply times).",
    arguments: [] as { name: string; description: string; required: boolean }[],
  },
  {
    name: "my_queue",
    title: "My queue",
    description: "The conversations assigned to me that wait for my reply, longest first, with what each customer asked.",
    arguments: [] as { name: string; description: string; required: boolean }[],
  },
  {
    name: "weekly_quality_review",
    title: "Weekly quality review",
    description: "Supervisors and admins: this week's chats against last week — reply rate, first reply time, unresolved, complaints, and per person.",
    arguments: [] as { name: string; description: string; required: boolean }[],
  },
];

/** The tool a prompt needs; the prompt is listed only when that tool is (P1). */
export const PROMPT_TOOL: Record<string, string> = {
  "daily-brief": "daily_brief",
  inbox_today: "inbox_overview",
  service_review: "service_performance",
  find_customer: "search",
  supervisor_morning: "chat_review",
  my_queue: "waiting_now",
  weekly_quality_review: "chat_review",
};

/** Yesterday in Malaysia time, YYYY-MM-DD. */
export function myYesterday(now = Date.now()): string {
  return new Date(now + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
}

export function rolePromptText(name: string, now = Date.now()): string | null {
  if (name === "supervisor_morning") {
    const y = myYesterday(now);
    return (
      "Supervisor morning check for Houzs Connect. 1) Use waiting_now: who is waiting for our reply right now, longest first, and who has each chat (with links). " +
      `2) Use chat_review with period=custom, from=${y}, to=${y}: yesterday's chats not replied, customers who complained repeatedly, and reply times per person against the day before. ` +
      "End with the three things I should act on first. Summarise; never paste customers' messages back. Short, plain language."
    );
  }
  if (name === "my_queue") {
    return (
      "My queue in Houzs Connect. Use daily_brief for the conversations assigned to me that wait for my reply, then waiting_now for how long each has waited. " +
      "List them longest first: customer, how long, what they asked (one line), and the link. If AI actions are on, you may offer to draft a reply with propose_chat_reply — never send anything without my explicit yes."
    );
  }
  if (name === "weekly_quality_review") {
    return (
      "Weekly quality review of customer service in Houzs Connect. Use chat_review with period=week and agent_workload with period=week. " +
      "Compare with last week: reply rate, first reply time, conversations not replied, unresolved, negative mood and repeat complainers; then per person (replies, first reply, on time). " +
      "Finish with what went better, what went worse and two concrete actions. Summarise; never paste customers' messages back."
    );
  }
  return null;
}

// ── P3: structured output ───────────────────────────────────────────────────

export const STRUCTURED_TOOLS = new Set([
  "inbox_overview",
  "waiting_now",
  "service_performance",
  "reply_speed",
  "agent_workload",
  "message_delivery",
  "contacts_summary",
  "campaign_summary",
  "customer_mood_scan",
  "chat_review",
  "customer_chat_summary",
  "daily_brief",
  "data_gaps",
]);

/** Open on purpose: each summary has its own fields, and some drop out for some roles. */
export const QUICK_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    link: { type: "string", description: "The Houzs Connect page this answer comes from" },
    truncated: { type: "boolean", description: "True when the answer was too long to send as JSON; `text` then holds it" },
    text: { type: "string" },
  },
  additionalProperties: true,
} as const;

/** The JSON object a quick answer's text carries (after optional one-line notes), or null. */
export function parseAnswer(t: string): Obj | null {
  const i = t.indexOf("{");
  if (i < 0) return null;
  try {
    const v = JSON.parse(t.slice(i)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
  } catch {
    return null;
  }
}

// ── P5: links ───────────────────────────────────────────────────────────────

/** The Connect page each quick answer comes from. */
export const TOOL_PAGES: Record<string, string> = {
  inbox_overview: "/inbox",
  waiting_now: "/inbox",
  service_performance: "/dashboard",
  reply_speed: "/dashboard",
  agent_workload: "/dashboard",
  message_delivery: "/logs",
  contacts_summary: "/contacts",
  campaign_summary: "/campaigns",
  customer_mood_scan: "/inbox",
  chat_review: "/inbox",
  customer_chat_summary: "/inbox",
  daily_brief: "/inbox",
  data_gaps: "/contacts",
};

/** Lists whose rows carry a bare `id` of a known record. */
const ID_LISTS: Record<string, Record<string, "conversation" | "campaign">> = {
  inbox_overview: { longestWaiting: "conversation" },
  campaign_summary: { latest: "campaign" },
};

const pageFor = (origin: string, kind: "conversation" | "contact" | "campaign", id: string) =>
  kind === "conversation" ? conversationUrl(origin, id) : kind === "contact" ? `${origin}/contacts?id=${encodeURIComponent(id)}` : `${origin}/campaigns/${encodeURIComponent(id)}`;

const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** P5 over one answer: a top-level `link`, and a `url` on each row naming a conversation / contact / campaign (an existing url is kept). */
export function withLinks(tool: string, value: Obj, origin: string): Obj {
  if (!origin) return value;
  const lists = ID_LISTS[tool] ?? {};
  const walk = (v: unknown, idKind: "conversation" | "campaign" | null, depth: number): unknown => {
    if (depth > 8) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, idKind, depth + 1));
    if (!v || typeof v !== "object" || v instanceof Date) return v;
    const o = v as Obj;
    const out: Obj = {};
    for (const [k, x] of Object.entries(o)) out[k] = walk(x, depth === 0 && lists[k] ? lists[k] : null, depth + 1);
    if (depth > 0 && typeof out.url !== "string") {
      const id = (k: string) => (typeof o[k] === "string" && SAFE.test(o[k] as string) ? (o[k] as string) : "");
      if (id("conversationId")) out.url = pageFor(origin, "conversation", id("conversationId"));
      else if (id("contactId")) out.url = pageFor(origin, "contact", id("contactId"));
      else if (idKind && id("id")) out.url = pageFor(origin, idKind, id("id"));
    }
    return out;
  };
  const out = walk(value, null, 0) as Obj;
  if (typeof out.link !== "string" && TOOL_PAGES[tool]) out.link = `${origin}${TOOL_PAGES[tool]}`;
  return out;
}

// ── P4: a short per-person cache for the heavy summaries ────────────────────

export const CACHED_TOOLS = new Set([
  "inbox_overview",
  "service_performance",
  "reply_speed",
  "agent_workload",
  "message_delivery",
  "contacts_summary",
  "campaign_summary",
  "customer_mood_scan",
  "chat_review",
  "data_gaps",
]);
export const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 300;

/** Stable JSON of the arguments (key order does not matter). */
export function argsKey(args: Obj): string {
  return JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]));
}

export class AnswerCache<T> {
  private map = new Map<string, { at: number; memberId: string; value: T }>();
  constructor(private ttl = CACHE_TTL_MS, private max = CACHE_MAX) {}
  static key(p: { memberId: string; role: string | null | undefined; modules: Module[]; tool: string; args: Obj }): string {
    return [p.memberId, p.role ?? "", p.modules.join(","), p.tool, argsKey(p.args)].join("|");
  }
  get(key: string, now = Date.now()): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (now - e.at > this.ttl) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }
  set(key: string, memberId: string, value: T, now = Date.now()): void {
    if (this.map.size >= this.max) {
      for (const [k, e] of this.map) if (now - e.at > this.ttl) this.map.delete(k);
      while (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    }
    this.map.set(key, { at: now, memberId, value });
  }
  /** After a confirmed action: this person's answers are stale. */
  clearMember(memberId: string): void {
    for (const [k, e] of this.map) if (e.memberId === memberId) this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

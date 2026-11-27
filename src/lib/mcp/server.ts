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
//    this path are the connector's own bookkeeping (mcp_calls, last_used_at) —
//    and, since round 4b, the three confirmed actions (write-actions.ts): off
//    until the admin switches them on, each one proposed first and run only on
//    the person's confirm_action, through Connect's own write cores
//    (lib/inbox-writes.ts, the code the inbox buttons run), never a new path.
// 3. Each call runs as the real person: their member row is re-read on every
//    request (inactive, access removed on the Team page, or AI Connector access
//    taken away → 401), their modules come from the same Settings → Access
//    rules requireModule() uses, and conversations go through the inbox rail's
//    own company + org-chart visibility predicate.
// 4. Credential-shaped fields are stripped from every reply; replies are capped.
//
// Speed (2026-11-25, owner: searching felt slow): quick answers (inbox_overview,
// service_performance) answer the common questions in one call; search / fetch
// in the shape ChatGPT requires; the door check is ONE query (store.ts
// checkAccessToken) plus the member read; the person's conversation scope is
// worked out once per request; the call log is one insert per request, written
// after the answer (waitUntil) instead of before it.

import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { member } from "@/db/schema";
import { bypassReadCache } from "@/db/fresh";
import { ensureAccessTables } from "@/db/ensure-access";
import { resolveModules, type Module } from "@/lib/module-access";
import { CORS_HEADERS, classifyPath, fitReply, isMcpAdminRole, MAX_RESULT_CHARS, MCP_PROTOCOL_VERSIONS, MCP_BLOCKED_PREFIXES, redactSecrets } from "./core";
import { conversationDoc, contactDoc, parseFetchId, PROMPTS, promptText, recordUrl } from "./quick";
import { ENDPOINTS, ReadError, companyName, findEndpoint, moduleCatalog, searchRecords, type McpMember, type ReadCtx } from "./reads";
import { checkAccessToken, countRecentCalls, logCalls, mcpDb, type McpCallRow } from "./store";
import {
  buildDailyBrief,
  DAILY_BRIEF_PROMPT,
  DAILY_BRIEF_TEXT,
  EXPORT_LISTS,
  EXPORT_ROW_CAP,
  EXPORT_TTL_MS,
  exportFileName,
  exportRows,
  MOOD_SCAN_REFUSAL,
  moodScanAllowed,
  myToday,
  pickColumns,
  RATE_LIMITS,
  rateLimitMessage,
  type BriefPart,
} from "./round3";
import { storeExport } from "./export-store";
import { addConversationLinks, buildDataGaps, CHAT_SUMMARY_MESSAGES, chatContentRefusal, PERIOD_SCHEMA, summariseCustomerChat } from "./round4";
import { buildXlsx } from "./xlsx";
import { ACTION_TTL_MS, ACTIONS_PER_DAY, pgActionStore, readSwitches, WRITE_KINDS, WRITE_LABELS, type Switches, type WriteKind } from "./actions";
import { cancelWrite, confirmWrite, KIND_MODULES, proposeWrite, type WriteDeps } from "./write-actions";
import { connectExec } from "./write-exec";
import { HOWTO_INSTRUCTIONS, HOWTO_PROMPT_TOOL, HOWTO_PROMPTS, HOWTO_TOOLS, howtoPromptText, isHowtoTool, runHowtoTool } from "./howto";
import { capsFor, type Viewer } from "./howto-types";
import { runScreenTool, SCREEN_TOOLS } from "./howto-screen";
import { hasShot, resolveShot, SHOW_ME_TOOL, showMeText, signShotLink, type ShotHit } from "./howto-shots";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AnswerCache, CACHED_TOOLS, parseAnswer, PROMPT_TOOL, QUICK_OUTPUT_SCHEMA, ROLE_PROMPTS, rolePromptText, STRUCTURED_TOOLS, withLinks } from "./round4c";

export const SERVER_INFO = { name: "houzs-connect", title: "Houzs Connect", version: "1.0.0" };

/** One request's caller. `memo` is per request (made fresh by mcpIdentity) — see ReadCtx. */
export type Identity = { tokenId: string; clientId: string; me: McpMember; modules: Module[]; memo: Map<string, Promise<unknown>> };
type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to Houzs Connect — the company's WhatsApp customer-service and follow-up platform (Service inbox, customers/contacts, payment slips, campaigns, automations, dashboard, message logs) — as the signed-in staff member.
Everything is limited to what this person can see in Houzs Connect, and READ-ONLY unless the admin switched AI actions on (below). Never guess figures a call did not return.
ANSWER FAST — use a quick answer first; it is one call and already summarised:
- Inbox now (open / waiting for our reply, by channel and by person, longest waits, today's and this week's messages, contacts added): inbox_overview.
- Who is waiting for a reply right now, longest first, and who has the chat: waiting_now.
- How fast are we replying today, who is slow, who waits past the reply SLA right now: reply_speed.
- Per person for a period (open chats now, replies, first reply time, on time): agent_workload {period}.
- What do I need to look at today: daily_brief.
- Response times / reply rate / who replied most, message volume vs the period before: service_performance {days: 7 | 30 | 90}.
- Failed / undelivered messages: message_delivery. Customers in numbers: contacts_summary. Campaigns: campaign_summary.
- Which customers are unhappy or complaining (supervisors and admins only): customer_mood_scan — summarise, never paste messages back.
- Chat review for a period — who was not replied, who was and what we said, who keeps complaining, quality vs the period before (supervisors and admins only): chat_review {period}.
- One customer's recent conversation by name / phone / order number (supervisors and admins only): customer_chat_summary {query}.
- Data to clean up (contacts with no name / phone, chats with no one assigned): data_gaps.
- period = today | week (Monday to now) | month | last_month | quarter | year | custom (from / to); each is compared with the period before (last week up to the same weekday, and so on).
- A list as an Excel file: export_excel {list, filters?, fields?} returns a download link valid 15 minutes.
- A customer, phone or order number: search {query}, then fetch {id} for the conversation or contact.
Only when no quick answer fits: connect_get with a path from list_endpoints (e.g. /conversations?status=OPEN, /payments?status=PENDING, /logs/messages?days=1). Pass q / status / days / limit to keep replies small.
A field missing from a reply means it is empty. Times are UTC ISO unless a reply says Malaysia time.
If a call says "Not available to your role", tell the person they do not have access to that part of Houzs Connect.
Message templates live in Settings, which the connector never reads.
Each person may make ${RATE_LIMITS.perMinute} tool calls a minute and ${RATE_LIMITS.perDay} a day; over that a call says so — wait instead of retrying at once.
ACTIONS (only the ones the admin switched on are listed): propose_chat_reply (a WhatsApp reply — it SENDS TO THE CUSTOMER), propose_conversation_assign (assign / reassign / resolve a chat), propose_contact_note (a line in a contact's Remarks, or a staff-only note on a chat). They do NOTHING yet — they return a summary and a confirmationId. Show the person that summary word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; if they say no or want changes, call cancel_action (and propose again). Never confirm on your own, never confirm something the person has not seen. A confirmation is single use and expires after ${ACTION_TTL_MS / 60_000} minutes; each person may confirm ${ACTIONS_PER_DAY} actions a day. Connect's own rules still apply: a typed reply only inside the 24-hour window (otherwise a template is sent from the inbox), only chats this person can see. Nothing else can be changed: no campaigns, broadcasts, deletes or contact imports.
${HOWTO_INSTRUCTIONS}`;

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
/**
 * Tools tied to one module are only listed to a person who has it (`module`);
 * a composite tool needs at least one of `anyModule` (round 4c P1). Write
 * actions (`writeKind`) and confirm / cancel (`actionTool`) are listed only
 * while the admin's switches allow them. These keys are stripped from tools/list.
 */
export type ToolDef = { name: string; module?: Module; anyModule?: Module[]; supervisorOnly?: boolean; writeKind?: WriteKind; actionTool?: boolean } & Record<string, unknown>;
const WRITE_ANN = (openWorld: boolean) => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: openWorld });
const NEXT_STEP = "Nothing is done yet: it returns a summary and a confirmationId. Show the summary to the person word for word and ask them to confirm. Only call confirm_action after they explicitly say yes.";
const CONVO_ARGS = {
  conversationId: { type: "string", description: "The conversation id (from waiting_now, search, customer_chat_summary or another answer)" },
  query: { type: "string", description: "Instead of conversationId: a customer name, phone or order number that matches exactly one chat you can see" },
};
export const TOOLS: ToolDef[] = [
  {
    name: "inbox_overview",
    module: "inbox",
    title: "Inbox overview (quick answer)",
    description:
      "The Service inbox right now in ONE call: open / pending / queued conversations, how many wait for our reply, by channel and by person, the 5 longest waits, and messages, new conversations and contacts added today and in the last 7 days. Only conversations this person can see.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "waiting_now",
    module: "inbox",
    title: "Waiting for a reply now (quick answer)",
    description:
      "Customers waiting for our reply RIGHT NOW in ONE call (not closed, the customer wrote last), longest wait first: how long, unanswered messages, assigned agent, department, channel, the last message (short), a link. Only conversations this person can see.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "1-100, default 50" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "service_performance",
    module: "dashboard",
    title: "Service performance (quick answer)",
    description:
      "Customer-service figures for the last 7, 30 or 90 days in ONE call: reply rate, average first reply and reply time (overall and per person), conversations by status, messages in/out vs the period before. Same numbers as the Dashboard.",
    inputSchema: { type: "object", properties: { days: { type: "number", enum: [7, 30, 90], description: "Default 7" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "reply_speed",
    module: "dashboard",
    title: "Reply speed (quick answer)",
    description:
      "How fast we reply, in ONE call: average first human reply, average reply and reply rate for today, yesterday and the last 7 days (the Dashboard's own measurement), per member (who is slow), and every conversation waiting on us longer than the reply SLA (customer, how long, assigned to).",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "agent_workload",
    module: "dashboard",
    title: "Agent workload (quick answer)",
    description:
      "Per team member in ONE call: open and waiting chats right now, and for the period (default today) replies sent, conversations handled, average first reply and reply time, first reply on time vs the SLA — the Dashboard's agents report — plus the team's reply figures against the previous period.",
    inputSchema: { type: "object", properties: { ...PERIOD_SCHEMA }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "message_delivery",
    module: "logs",
    title: "Message delivery (quick answer)",
    description: "Today's outbound WhatsApp messages by where they got to (sent / delivered / read / failed / waiting) and the failed ones of the last N days with Meta's reason. ONE call.",
    inputSchema: { type: "object", properties: { days: { type: "number", description: "Failed messages of the last N days, 1-30 (default 7)" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "contacts_summary",
    module: "contacts",
    title: "Contacts in numbers (quick answer)",
    description: "Customers in ONE call: total, with an open order, with a balance due, waiting, blocked, added today and in the last 7 days, and the most used tags.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "campaign_summary",
    module: "campaigns",
    title: "Campaigns (quick answer)",
    description: "Broadcast campaigns in ONE call: how many by status, total audience / sent / failed, and the latest 10 with their numbers.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "customer_mood_scan",
    module: "inbox",
    supervisorOnly: true,
    title: "Unhappy customers (supervisors and admins)",
    description:
      "SUPERVISORS AND ADMINS ONLY. Customers' own messages of a day (default today; or from/to, at most 7 days), grouped by conversation, most active first, clipped to 300 characters, at most 200 messages, with flags: unanswered messages in a row, waiting past the reply SLA, complaint keywords. Use it to find who is unhappy or complaining and SUMMARISE them (who, what about, how long they waited, who has the chat, what to do) — never paste the messages back.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, default today (Malaysia time)" },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD, at most 7 days after from" },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "chat_review",
    module: "inbox",
    supervisorOnly: true,
    title: "Chat review (supervisors and admins)",
    description:
      "SUPERVISORS AND ADMINS ONLY. Review the chats of a period (default today; week = Monday to now) in ONE call: conversations NOT replied by a person (longest wait first, with the customer's last message, short), conversations replied (with a short snippet of what we replied and who), customers who complain repeatedly, and a quality view — reply rate, first reply time, unresolved, negative mood, reply times per person — against the previous period. SUMMARISE for a supervisor; never paste the messages back.",
    inputSchema: { type: "object", properties: { ...PERIOD_SCHEMA }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "customer_chat_summary",
    module: "inbox",
    supervisorOnly: true,
    title: "One customer's chat (supervisors and admins)",
    description:
      "SUPERVISORS AND ADMINS ONLY. A customer's name, phone or order number (or a conversationId) → their most recent conversation this person can see, in ONE call: status, who has it, order ref, flags (unanswered in a row, waiting, complaint hints), the latest messages (clipped), internal notes, and other matching conversations. SUMMARISE it; never paste the messages back.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Customer name, phone or order number" },
        conversationId: { type: "string", description: "A conversation id (from otherMatches or another answer) instead of query" },
        messages: { type: "number", description: `Latest messages to read, 1-100 (default ${CHAT_SUMMARY_MESSAGES})` },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "daily_brief",
    anyModule: ["inbox", "payments", "logs"],
    title: "My day (quick answer)",
    description:
      "What this person needs to look at today in ONE call: conversations assigned to them that wait for their reply, the inbox's longest waits, payment slips to check and failed messages. A part they may not read says so; the rest still answers.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "data_gaps",
    anyModule: ["contacts", "inbox"],
    title: "Data gaps (quick answer)",
    description:
      "Data to clean up in ONE call: contacts with no name (or only a number), no phone or a phone too short to be real, and not-closed conversations with no one assigned (with examples and links). A part this person may not read says so.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "export_excel",
    anyModule: ["inbox", "contacts", "payments", "logs", "campaigns"],
    title: "Export a list to Excel",
    description: `Build an .xlsx of a list as this person sees it and return a download link valid 15 minutes, the row count and whether it was cut at ${EXPORT_ROW_CAP} rows. Lists: conversations (q, status, unread, assigned=me), contacts (q, segment, tag), payments (q, status), logs (q, status, direction, days), campaigns. Customer message text is never exported. "fields" picks columns (keys or headers).`,
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "string", enum: Object.keys(EXPORT_LISTS) },
        filters: { type: "object", description: 'Filters for that list, e.g. {"status":"PENDING"}', additionalProperties: { type: ["string", "number", "boolean"] } },
        fields: { type: "array", items: { type: "string" }, description: 'Columns to keep, e.g. ["customer","amount","status"]' },
      },
      required: ["list"],
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "search",
    anyModule: ["inbox", "contacts"],
    title: "Search conversations and contacts",
    description:
      'Search the conversations and customers this person can see by name, phone, order number or message text. Returns {"results":[{"id","title","url"}]}; open one with fetch.',
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name, phone, order number or words from a message" } }, required: ["query"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "fetch",
    anyModule: ["inbox", "contacts"],
    title: "Open a conversation or contact",
    description: 'Open one search result by its id (e.g. "conversation:abc123" or "contact:abc123"). Returns {"id","title","text","url","metadata"}.',
    inputSchema: { type: "object", properties: { id: { type: "string", description: "An id from search" } }, required: ["id"], additionalProperties: false },
    annotations: RO,
  },
  // Round 5: process help — no Connect data, every person (canDo follows their own access).
  ...HOWTO_TOOLS.map((t) => ({ ...t }) as ToolDef),
  ...SCREEN_TOOLS.map((t) => ({ ...t }) as ToolDef),
  { ...SHOW_ME_TOOL } as ToolDef,
  { name: "whoami", title: "Who am I connected as", description: "The Houzs Connect account this connection uses: name, company, role and which modules it can read.", inputSchema: NO_ARGS, annotations: RO },
  { name: "list_modules", title: "List modules", description: "The Houzs Connect modules this person can read, with how many read endpoints each has.", inputSchema: NO_ARGS, annotations: RO },
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
    description: "Read one endpoint (from list_endpoints) as the signed-in person and return its JSON. Prefer a quick answer or search first. Long lists are trimmed to fit; narrow them with query parameters.",
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
  // ── round 4b write actions (owner 2026-11-26), each behind its own admin switch ──
  {
    name: "propose_chat_reply",
    writeKind: "chat_reply",
    title: "Propose a reply to a customer (SENDS TO THE CUSTOMER after a yes)",
    description: `Draft a WhatsApp reply in a customer conversation this person can see. On confirm it is SENT TO THE CUSTOMER from Houzs Connect, as this person — the inbox's own send. Only inside the 24-hour reply window (outside it WhatsApp refuses typed text; a template is sent from the inbox instead). If a colleague replies first, it is not sent. ${NEXT_STEP}`,
    inputSchema: {
      type: "object",
      properties: { ...CONVO_ARGS, text: { type: "string", description: `The reply, plain text, at most 4096 characters` } },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: WRITE_ANN(true),
  },
  {
    name: "propose_conversation_assign",
    writeKind: "conversation_assign",
    title: "Propose assigning or resolving a conversation (needs a yes)",
    description: `Assign or reassign a conversation this person can see (to a person of the company, "me" or "nobody", and/or a department), and/or change its status (open, pending, resolved) — the inbox's Assign and Resolve buttons. Nothing is sent to the customer. ${NEXT_STEP}`,
    inputSchema: {
      type: "object",
      properties: {
        ...CONVO_ARGS,
        assign_to: { type: "string", description: 'A person\'s name or email, "me", or "nobody"' },
        department: { type: "string", description: 'A department name, or "none"' },
        status: { type: "string", enum: ["open", "pending", "resolved"] },
      },
      additionalProperties: false,
    },
    annotations: WRITE_ANN(false),
  },
  {
    name: "propose_contact_note",
    writeKind: "contact_note",
    title: "Propose a note on a contact (needs a yes)",
    description: `Add a dated line to a contact's Remarks (as="remarks", the default) or a staff-only internal note on a chat (as="internal_note"). Never sent to the customer. Give a conversationId (a chat this person can see), or for Remarks a contact (name, phone or id) from the Contacts page. ${NEXT_STEP}`,
    inputSchema: {
      type: "object",
      properties: {
        ...CONVO_ARGS,
        contact: { type: "string", description: "For Remarks without a chat: the contact's name, phone or id" },
        as: { type: "string", enum: ["remarks", "internal_note"], description: "Default remarks" },
        note: { type: "string", description: "The note, one short paragraph (at most 1000 characters)" },
      },
      required: ["note"],
      additionalProperties: false,
    },
    annotations: WRITE_ANN(false),
  },
  {
    name: "confirm_action",
    actionTool: true,
    title: "Confirm a proposed action (only after the person said yes)",
    description: "Carry out ONE proposed action (propose_chat_reply / propose_conversation_assign / propose_contact_note) after the person explicitly said yes to its summary. Single use; expires 10 minutes after the proposal.",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string", description: "The confirmationId from the propose_… tool" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: WRITE_ANN(true),
  },
  {
    name: "cancel_action",
    actionTool: true,
    title: "Cancel a proposed action",
    description: "Drop a proposed action the person said no to (or wants changed). Nothing is sent or changed.",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** Round 4c P4: heavy summaries reused for 60 s per person (this isolate only). */
const answerCache = new AnswerCache<ToolResult>();
/** For scripts: forget every cached answer. */
export const clearAnswerCache = () => answerCache.clear();

/** Round 4c P1: may this person use this tool now? The same answer tools/list gives. */
export function toolAllowed(t: ToolDef, modules: Module[], role: string | null | undefined, sw: Switches | null): boolean {
  if (t.module && !modules.includes(t.module)) return false;
  if (t.anyModule && !t.anyModule.some((m) => modules.includes(m))) return false;
  if (t.supervisorOnly && !moodScanAllowed(role)) return false;
  if (t.writeKind) return !!sw && sw.main && sw[t.writeKind] && KIND_MODULES[t.writeKind].some((m) => modules.includes(m));
  if (t.actionTool) return !!sw && sw.main && WRITE_KINDS.some((k) => sw[k] && KIND_MODULES[k].some((m) => modules.includes(m)));
  return true;
}

/** Round 4c P3 + P5: a quick answer also as structuredContent, with its Connect page link; the text carries the same JSON. */
function structured(name: string, r: ToolResult, origin: string): ToolResult {
  const raw = r.content[0]?.text ?? "";
  const v = parseAnswer(raw);
  if (!v) return { ...r, structuredContent: { text: raw, truncated: true } };
  const value = withLinks(name, v, origin);
  const head = raw.slice(0, raw.indexOf("{"));
  let body = JSON.stringify(value);
  if (head.length + body.length > MAX_RESULT_CHARS) body = JSON.stringify(v); // links never push an answer over the cap
  return { ...r, content: [{ type: "text", text: head + body }], structuredContent: value };
}

function writeDeps(db: DB, id: Identity): WriteDeps {
  return {
    store: pgActionStore(db),
    tokenId: id.tokenId,
    me: { id: id.me.id, email: id.me.email, name: id.me.name },
    modules: id.modules,
    read: async (path, query) => {
      const r = await readEndpoint(db, id, path, query ?? {});
      return { status: r.status, body: r.body, message: r.result.content[0]?.text ?? "" };
    },
    exec: connectExec(db, id.me),
  };
}

/** Which actions are on, in words (whoami / list_modules). */
function actionsInWords(sw: Switches): string {
  if (!sw.main) return "switched off";
  const on = WRITE_KINDS.filter((k) => sw[k]).map((k) => WRITE_LABELS[k].title);
  return on.length ? `${on.join("; ")} — each only after the person confirms` : "switched on, but no action is turned on";
}

/**
 * The person behind a connector token, or null (unknown / expired / revoked /
 * inactive / access removed / AI Connector access taken away). Two queries: the
 * token + every access rule (store.checkAccessToken), then the member row with
 * its department. Both bypass Hyperdrive's read cache.
 */
export async function mcpIdentity(db: DB, token: string): Promise<Identity | null> {
  await Promise.all([mcpDb(db), ensureAccessTables(db)]);
  const t = await checkAccessToken(db, token);
  if (!t || !t.active || t.removed) return null;
  // Fresh (db/fresh.ts): a person switched off a moment ago must not get one more answer.
  const me = await db.query.member.findFirst({ where: and(eq(member.id, t.memberId), bypassReadCache()), with: { department: true } });
  if (!me || !me.active) return null;
  // Connector admins always may; everyone else needs an approval (store.hasMcpAccess's rule).
  if (!isMcpAdminRole(me.role) && !t.approved) return null;
  const modules = resolveModules(me.role, t.moduleChoices);
  return { tokenId: t.tokenId, clientId: t.clientId, me, modules, memo: new Map() };
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
    const ctx: ReadCtx = { db, me: id.me, modules: id.modules, memo: id.memo };
    body = await found.ep.run(ctx, found.params, q);
  } catch (e) {
    if (e instanceof ReadError) return { result: text(e.message, true), status: e.status, note: e.message.slice(0, 120), target, body: null, removed: [] };
    console.error("[mcp] read failed:", target, e);
    return { result: text("Houzs Connect could not read that just now. Try again, or narrow the query.", true), status: 500, note: "read failed", target, body: null, removed: [] };
  }
  const { value, removed } = redactSecrets(body);
  const notes = removed.size ? [`Credential fields removed: ${[...removed].join(", ")}.`] : [];
  return { result: text(fitReply(value, notes).text), status: 200, note: "", target, body: value, removed: [...removed] };
}

/** A quick answer is a catalogue endpoint with its own tool name: same gate, redaction and log. */
const QUICK_PATHS: Record<string, (args: Record<string, unknown>) => { path: string; query: Record<string, unknown> }> = {
  inbox_overview: () => ({ path: "/inbox/overview", query: {} }),
  service_performance: (a) => ({ path: "/dashboard/service", query: a.days === undefined ? {} : { days: a.days } }),
  reply_speed: () => ({ path: "/dashboard/reply-speed", query: {} }),
  message_delivery: (a) => ({ path: "/logs/delivery", query: a.days === undefined ? {} : { days: a.days } }),
  contacts_summary: () => ({ path: "/contacts/summary", query: {} }),
  campaign_summary: () => ({ path: "/campaigns/summary", query: {} }),
  customer_mood_scan: (a) => ({ path: "/inbox/mood-scan", query: { date: a.date, from: a.from, to: a.to } }),
  waiting_now: (a) => ({ path: "/inbox/waiting", query: a.limit === undefined ? {} : { limit: a.limit } }),
  agent_workload: (a) => ({ path: "/dashboard/agents", query: { period: a.period, from: a.from, to: a.to } }),
};

/** Quick answers whose rows carry a conversationId: the reply gets each row's inbox link. */
const LINKED = new Set(["waiting_now", "customer_mood_scan"]);

/** A read's body with inbox links added, re-fitted under the reply cap. */
function relink(r: ReadOutcome, body: unknown, origin: string): ReadOutcome {
  const notes = r.removed.length ? [`Credential fields removed: ${r.removed.join(", ")}.`] : [];
  return { ...r, result: text(fitReply(addConversationLinks(body, origin), notes).text) };
}

const strArg = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : "");

/**
 * chat_review: /inbox/chat-review (inbox visibility; the endpoint itself holds the
 * supervisor gate) + /dashboard/agents for reply times in the Dashboard's own
 * measurement — a person without the Dashboard gets that part as "no access".
 */
async function chatReviewTool(db: DB, id: Identity, args: Record<string, unknown>, origin: string): Promise<ReadOutcome> {
  const q = { period: args.period, from: args.from, to: args.to };
  const [rev, agents] = await Promise.all([readEndpoint(db, id, "/inbox/chat-review", q), readEndpoint(db, id, "/dashboard/agents", q)]);
  if (rev.result.isError) return rev;
  const a = briefPart(agents, "the Dashboard");
  const ag = a.ok ? (a.value as Record<string, unknown>) : null;
  const replyTimes = ag
    ? {
        timing: ag.timing,
        team: ag.team,
        previousPeriod: ag.previousPeriod,
        byAgent: ((ag.byAgent as Record<string, unknown>[] | undefined) ?? []).slice(0, 15).map((p) => ({ name: p.name, replies: p.replies, avgFirstReply: p.avgFirstReply, avgReply: p.avgReply, firstReplyOnTime: p.firstReplyOnTime })),
      }
    : { unavailable: (a as { message: string }).message };
  return relink(rev, { ...(rev.body as Record<string, unknown>), replyTimes }, origin);
}

/** customer_chat_summary: /conversations?q= (to find the customer) then /conversations/:id, both as the person. */
async function customerChatSummary(db: DB, id: Identity, args: Record<string, unknown>, origin: string): Promise<ReadOutcome> {
  const query = strArg(args.query, 100);
  let pick = strArg(args.conversationId, 100);
  const target = `customer_chat:${(query || pick).slice(0, 100)}`;
  let matches: Record<string, unknown>[] = [];
  if (!pick) {
    if (!query) return { result: text("Give a customer name, phone or order number (query), or a conversationId.", true), status: 400, note: "no query", target, body: null, removed: [] };
    const s = await readEndpoint(db, id, "/conversations", { q: query, limit: 6 });
    if (s.result.isError) return { ...s, target };
    matches = ((s.body as Record<string, unknown>)?.conversations as Record<string, unknown>[] | undefined) ?? [];
    if (!matches.length) return { ...s, target, result: asJson({ found: false, message: `No conversation you can see in Service matches "${query}".` }), note: "no match" };
    pick = String(matches[0].id);
  }
  const msgs = typeof args.messages === "number" ? Math.min(100, Math.max(1, Math.floor(args.messages))) : CHAT_SUMMARY_MESSAGES;
  const t = await readEndpoint(db, id, `/conversations/${pick}`, { limit: msgs });
  if (t.result.isError) return { ...t, target };
  return relink({ ...t, target }, summariseCustomerChat(t.body, matches.filter((m) => String(m.id) !== pick)), origin);
}

/** data_gaps: three catalogue reads as the person; each keeps its own module gate. */
async function dataGaps(db: DB, id: Identity, origin: string): Promise<unknown> {
  const [contacts, overview, unassigned] = await Promise.all([
    readEndpoint(db, id, "/contacts/gaps", {}),
    readEndpoint(db, id, "/inbox/overview", {}),
    readEndpoint(db, id, "/conversations", { assigned: "none", open: "true", limit: 10 }),
  ]);
  return addConversationLinks(
    buildDataGaps({ contacts: briefPart(contacts, "Contacts"), overview: briefPart(overview, "the Service inbox"), unassigned: briefPart(unassigned, "the Service inbox") }),
    origin
  );
}

/** One read of a composite answer as a brief part: refused / failed reads become one plain line. */
function briefPart(r: ReadOutcome, what: string): BriefPart {
  if (!r.result.isError) return { ok: true, value: r.body };
  return { ok: false, message: r.status === 403 ? `You do not have access to ${what} in Houzs Connect.` : r.result.content[0].text.slice(0, 200) };
}

async function dailyBrief(db: DB, id: Identity, origin: string): Promise<unknown> {
  // Four catalogue reads as the person, side by side; each keeps its own module gate.
  const [overview, mine, payments, delivery] = await Promise.all([
    readEndpoint(db, id, "/inbox/overview", {}),
    readEndpoint(db, id, "/conversations", { assigned: "me", open: "true", limit: 50 }),
    readEndpoint(db, id, "/payments", { status: "PENDING", limit: 5 }),
    readEndpoint(db, id, "/logs/delivery", { days: 1 }),
  ]);
  return buildDailyBrief(
    { overview: briefPart(overview, "the Service inbox"), mine: briefPart(mine, "the Service inbox"), payments: briefPart(payments, "payments"), delivery: briefPart(delivery, "System Logs") },
    { name: id.me.name },
    origin
  );
}

/** export_excel: page through one catalogue list as the person, up to EXPORT_ROW_CAP rows, into an .xlsx behind a 15-minute link. */
async function exportExcel(db: DB, id: Identity, args: Record<string, unknown>, origin: string, defer?: (p: Promise<unknown>) => void): Promise<ReadOutcome> {
  const listName = String(args.list ?? "");
  const cfg = EXPORT_LISTS[listName];
  const target0 = `export:${listName.slice(0, 40)}`;
  if (!cfg) return { result: text(`Unknown list. Lists you can export: ${Object.keys(EXPORT_LISTS).join(", ")}.`, true), status: 400, note: "unknown list", target: target0, body: null, removed: [] };
  const given = args.filters && typeof args.filters === "object" && !Array.isArray(args.filters) ? (args.filters as Record<string, unknown>) : {};
  const filters: Record<string, unknown> = {};
  for (const k of cfg.filters) if (given[k] !== undefined && given[k] !== null && typeof given[k] !== "object") filters[k] = given[k];
  const target = `${target0}${Object.keys(filters).length ? `?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString()}` : ""}`.slice(0, 480);
  const rows: Record<string, unknown>[] = [];
  const removed = new Set<string>();
  let truncated = false;
  for (let offset = 0; ; offset += cfg.page) {
    const r = await readEndpoint(db, id, cfg.path, { ...filters, limit: cfg.page, offset });
    if (r.result.isError) {
      if (offset === 0) return { ...r, target };
      truncated = true;
      break;
    }
    for (const k of r.removed) removed.add(k);
    const got = ((r.body as Record<string, unknown>)?.[cfg.rowsKey] as Record<string, unknown>[] | undefined) ?? [];
    for (const row of got) {
      if (rows.length >= EXPORT_ROW_CAP) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    if (truncated || got.length < cfg.page) break;
  }
  const columns = pickColumns(cfg.columns, args.fields);
  const fileName = exportFileName(listName, myToday());
  const bytes = await buildXlsx(cfg.title, columns, exportRows(rows, columns));
  const link = await storeExport(bytes, fileName, { memberId: id.me.id, email: id.me.email }, origin, defer);
  return {
    result: asJson({
      download: link.url,
      fileName,
      rows: rows.length,
      truncated,
      ...(truncated ? { note: `Cut at ${EXPORT_ROW_CAP} rows — narrow the filters for the rest.` } : {}),
      linkExpiresAt: link.expiresAt,
      linkValidMinutes: EXPORT_TTL_MS / 60_000,
      columns: columns.map((c) => c.header),
      ...(removed.size ? { credentialFieldsRemoved: [...removed] } : {}),
    }),
    status: 200,
    note: `${rows.length} rows${truncated ? ", truncated" : ""}, ${bytes.length} bytes`,
    target,
    body: null,
    removed: [...removed],
  };
}

const asJson = (v: unknown) => text(JSON.stringify(v));

/** ChatGPT's fetch: one conversation or contact as {id, title, text, url, metadata}. */
async function fetchRecord(db: DB, id: Identity, rawId: unknown, origin: string): Promise<ReadOutcome> {
  const f = parseFetchId(rawId);
  if (!f) {
    return { result: text('Unknown id — use an id from search, e.g. "conversation:abc123" or "contact:abc123".', true), status: 400, note: "bad id", target: String(rawId ?? "").slice(0, 200), body: null, removed: [] };
  }
  const r = await readEndpoint(db, id, f.kind === "conversation" ? `/conversations/${f.rowId}` : `/contacts/${f.rowId}`, {});
  if (r.result.isError) return r;
  const doc = f.kind === "conversation" ? conversationDoc(r.body) : contactDoc(r.body);
  const room = MAX_RESULT_CHARS - 2_000;
  const body = {
    id: `${f.kind}:${f.rowId}`,
    title: doc.title,
    text: doc.text.length > room ? doc.text.slice(0, room) + "\n[cut — ask for fewer messages with connect_get]" : doc.text,
    url: recordUrl(origin, f.kind, f.rowId),
    metadata: r.removed.length ? { ...doc.metadata, credentialFieldsRemoved: r.removed } : doc.metadata,
  };
  return { ...r, result: asJson(body) };
}

/**
 * Round 5: the person as the help tools see them — role, modules, their company's
 * role-matrix capabilities (connect.role_permission over lib/permissions.ts
 * DEFAULTS, the same as can()) and company name. A missing table = the defaults.
 */
async function howtoViewer(db: DB, id: Identity): Promise<Viewer> {
  const saved = id.me.role === "SUPER_ADMIN"
    ? []
    : await (db.execute(sql`select capability, allowed from connect.role_permission where company_id = ${id.me.companyId} and role = ${id.me.role === "OWNER" ? "ADMIN" : id.me.role}`) as unknown as Promise<{ capability: string; allowed: boolean }[]>).catch(() => []);
  return { role: id.me.role, modules: id.modules, caps: capsFor(id.me.role, saved), company: (await companyName(db, id.me.companyId).catch(() => "")) ?? "" };
}

/** Round 5b: the screenshot's bytes, from the Worker's static assets (public/help-shots), base64. Null when not reachable. */
async function shotImage(origin: string, file: string): Promise<string | null> {
  const url = `${origin}/help-shots/${encodeURIComponent(file)}`;
  try {
    const assets = (getCloudflareContext().env as unknown as { ASSETS?: { fetch: (r: Request) => Promise<Response> } }).ASSETS;
    const res = assets ? await assets.fetch(new Request(url)) : await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}

/** Round 5b: show_me — the WebP (image content, never SVG), the box, a 15-minute annotated link, the live link. */
async function showMe(id: Identity, viewer: Viewer, args: Record<string, unknown>, origin: string): Promise<{ result: ToolResult; status: number; target: string; note: string }> {
  const hit: ShotHit | null = resolveShot(args, viewer);
  if (!hit) {
    return {
      result: text("No screenshot for that yet (or it is a page you cannot open). Give the steps from how_to with their links instead — each link highlights the button on the live page.", true),
      status: 404,
      target: `show_me ${String(args.guide_id ?? args.path ?? args.label ?? "").slice(0, 80)}`,
      note: "no shot",
    };
  }
  let secret = "";
  try {
    secret = (getCloudflareContext().env as unknown as { SESSION_SECRET?: string }).SESSION_SECRET ?? "";
  } catch {
    /* scripts: no Worker env */
  }
  const link = secret ? await signShotLink(origin, hit, secret) : null;
  const data = await shotImage(origin, hit.shot.file);
  const meta = { type: "text" as const, text: JSON.stringify(showMeText(hit, origin, link)) };
  return {
    // The image block rides in content as MCP allows; nothing downstream reads it (show_me is never cached or structured).
    result: { content: data ? [meta, { type: "image", data, mimeType: "image/webp" } as unknown as typeof meta] : [meta] },
    status: 200,
    target: `show_me ${hit.page} ${hit.label}`.slice(0, 200),
    note: data ? "" : "image not loaded",
  };
}

async function callTool(db: DB, id: Identity, name: string, args: Record<string, unknown>, origin: string, logs: McpCallRow[], defer?: (p: Promise<unknown>) => void): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200;
  let note = "";
  let target = "";
  let result: ToolResult;
  try {
    // Per person (email), tool calls only; refused calls are logged as 429 and not counted.
    // The admin leak check reads through readEndpoint, never here, so it is never limited.
    const refused = rateLimitMessage(await countRecentCalls(db, id.me.email));
    const def = TOOLS.find((tl) => tl.name === name);
    const cacheKey = CACHED_TOOLS.has(name) ? AnswerCache.key({ memberId: id.me.id, role: id.me.role, modules: id.modules, tool: name, args }) : "";
    const cached = cacheKey ? answerCache.get(cacheKey) : undefined;
    if (refused) {
      result = text(refused, true);
      status = 429;
      note = "rate limited";
    } else if (def?.supervisorOnly && !moodScanAllowed(id.me.role)) {
      // Chat content (owner 2026-11-26): customer_mood_scan's gate, before any read.
      result = text(name === "customer_mood_scan" ? MOOD_SCAN_REFUSAL : chatContentRefusal(name), true);
      status = 403;
      note = "supervisors and admins only";
      target = name;
    } else if (def?.anyModule && !toolAllowed(def, id.modules, id.me.role, null)) {
      // Round 4c P1: hidden from this person's tools/list → "no access" when called directly.
      result = text(`Not available to your role: ${name} needs ${def.anyModule.join(" or ")}, which is not turned on for this account in Houzs Connect.`, true);
      status = 403;
      note = "no permission";
      target = name;
    } else if (def?.writeKind) {
      // Round 4b: propose only — nothing is written to Connect here.
      const o = await proposeWrite(writeDeps(db, id), def.writeKind, args);
      status = o.status;
      target = o.target;
      note = o.ok ? "proposed" : o.text.slice(0, 120);
      result = o.ok
        ? asJson({
            confirmationId: o.confirmationId,
            summary: o.summary,
            warnings: o.warnings ?? [],
            expiresInMinutes: ACTION_TTL_MS / 60_000,
            next: "Nothing has been done yet. Show this summary to the person word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action.",
          })
        : text(o.text, true);
    } else if (name === "confirm_action") {
      const o = await confirmWrite(writeDeps(db, id), args.confirmationId);
      status = o.status;
      target = o.target;
      note = o.ok ? "confirmed" : o.text.slice(0, 120);
      result = text(o.text, !o.ok);
      if (o.ok) answerCache.clearMember(id.me.id); // the person's summaries are stale now
    } else if (name === "cancel_action") {
      const o = await cancelWrite({ store: pgActionStore(db), tokenId: id.tokenId, me: id.me }, args.confirmationId);
      status = o.status;
      target = o.target;
      result = text(o.text, !o.ok);
    } else if (isHowtoTool(name)) {
      // Round 5: pure help — no Connect data; a question no guide answers is logged (note "no-guide").
      const o = runHowtoTool({ viewer: await howtoViewer(db, id), origin, hasShot }, name, args);
      result = o.result;
      status = o.status;
      note = o.note;
      target = o.target;
    } else if (name === "explain_screen" || name === "where_is") {
      const o = runScreenTool({ viewer: await howtoViewer(db, id), origin, hasShot }, name, args);
      result = o?.result ?? text(`Unknown tool: ${name}`, true);
      status = o?.status ?? 400;
      note = o?.note ?? "";
      target = o?.target ?? name;
    } else if (name === "show_me") {
      const o = await showMe(id, await howtoViewer(db, id), args, origin);
      result = o.result;
      status = o.status;
      note = o.note;
      target = o.target;
    } else if (cached) {
      // Round 4c P4: same person, role, modules and arguments within 60 s — the gates above already ran.
      result = cached;
      note = "cached";
      target = `${name} (cached)`;
    } else if (name === "chat_review" || name === "customer_chat_summary") {
      const r = name === "chat_review" ? await chatReviewTool(db, id, args, origin) : await customerChatSummary(db, id, args, origin);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else if (name === "data_gaps") {
      target = `data_gaps:${myToday()}`;
      result = asJson(await dataGaps(db, id, origin));
    } else if (name === "daily_brief") {
      target = `daily_brief:${myToday()}`;
      result = asJson(await dailyBrief(db, id, origin));
    } else if (name === "export_excel") {
      const r = await exportExcel(db, id, args, origin, defer);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else if (name === "whoami") {
      const m = id.me;
      const sw = await readSwitches(db);
      result = text(
        JSON.stringify({
          name: m.name,
          email: m.email,
          company: await companyName(db, m.companyId),
          role: m.role,
          title: m.title,
          department: m.department?.name ?? null,
          modules: id.modules,
          readOnly: !sw.main,
          actions: actionsInWords(sw),
        })
      );
    } else if (name === "list_modules") {
      const sw = await readSwitches(db);
      result = text(
        JSON.stringify({
          readOnly: !sw.main,
          actions: actionsInWords(sw),
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
    } else if (name === "connect_get" || QUICK_PATHS[name]) {
      const q = QUICK_PATHS[name] ? QUICK_PATHS[name](args) : { path: args.path, query: args.query };
      const r0 = await readEndpoint(db, id, q.path, q.query);
      const r = LINKED.has(name) && !r0.result.isError ? relink(r0, r0.body, origin) : r0;
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else if (name === "search") {
      const query = typeof args.query === "string" ? args.query : "";
      target = query.slice(0, 200);
      if (!id.modules.includes("inbox") && !id.modules.includes("contacts")) {
        result = text("Not available to your role: neither Service nor Contacts is turned on for this account in Houzs Connect.", true);
        status = 403;
        note = "no permission";
      } else {
        result = asJson({ results: await searchRecords({ db, me: id.me, modules: id.modules, memo: id.memo }, query, origin) });
      }
    } else if (name === "fetch") {
      const r = await fetchRecord(db, id, args.id, origin);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else {
      result = text(`Unknown tool: ${name}`, true);
      status = 400;
    }
    if (STRUCTURED_TOOLS.has(name) && !result.isError && !result.structuredContent) result = structured(name, result, origin);
    if (cacheKey && !cached && !result.isError && status === 200) answerCache.set(cacheKey, id.me.id, result);
  } catch (e) {
    console.error("[mcp] tool failed:", name, e);
    result = text("The tool failed. Try again.", true);
    status = 500;
  }
  logs.push({
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

/**
 * Tools for this person (round 4c P1): only what they can use — modules, the
 * supervisor gate, and the admin's action switches (`sw`; null = actions off).
 * Internal keys are not sent; quick answers carry their outputSchema (P3).
 */
export function toolsFor(modules: Module[], role?: string | null, sw: Switches | null = null) {
  return TOOLS.filter((t) => toolAllowed(t, modules, role, sw)).map((t) => {
    const out: Record<string, unknown> = { ...t };
    for (const k of ["module", "anyModule", "supervisorOnly", "writeKind", "actionTool"]) delete out[k];
    if (STRUCTURED_TOOLS.has(t.name)) out.outputSchema = QUICK_OUTPUT_SCHEMA;
    return out;
  });
}

/** Prompts for this person (round 4c P2): a prompt shows when the tool it relies on does. */
function promptsFor(modules: Module[], role: string | null | undefined) {
  return [DAILY_BRIEF_PROMPT, ...PROMPTS, ...ROLE_PROMPTS, ...HOWTO_PROMPTS].filter((p) => {
    const t = TOOLS.find((x) => x.name === (PROMPT_TOOL[p.name] ?? HOWTO_PROMPT_TOOL[p.name]));
    return !t || toolAllowed(t, modules, role, null);
  });
}

/**
 * One JSON-RPC message. Tool calls append their call-log row to `logs`; the
 * caller writes them (handleMcpPost: one insert, after the answer). Without
 * `logs` (a direct caller), they are written before returning.
 */
export async function handleRpc(db: DB, id: Identity, m: RpcReq, origin = "", logs?: McpCallRow[], defer?: (p: Promise<unknown>) => void): Promise<unknown> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  if (!m || typeof m !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolsFor(id.modules, id.me.role, await readSwitches(db)) });
    case "tools/call": {
      const own = logs ?? [];
      const r = await callTool(db, id, String(m.params?.name ?? ""), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}, origin, own, defer);
      if (!logs) await logCalls(db, own);
      return reply(r);
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: promptsFor(id.modules, id.me.role) });
    case "prompts/get": {
      const name = String(m.params?.name ?? "");
      const shown = promptsFor(id.modules, id.me.role).find((p) => p.name === name);
      const body = !shown
        ? null
        : name === DAILY_BRIEF_PROMPT.name
          ? DAILY_BRIEF_TEXT
          : (rolePromptText(name) ?? howtoPromptText(name, (m.params?.arguments as Record<string, unknown> | undefined) ?? {}) ?? promptText(name, (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
      if (body === null) return { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32602, message: `Unknown prompt: ${name.slice(0, 60)}` } };
      return reply({ description: shown?.description ?? "", messages: [{ role: "user", content: { type: "text", text: body } }] });
    }
    default:
      if (m.id === undefined || m.id === null || (m.method ?? "").startsWith("notifications/")) return null;
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ""}` } };
  }
}

export { CORS_HEADERS };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS, ...extra } });

/**
 * The whole POST /api/mcp exchange. `origin` is the public address
 * (core.originFor). `defer` runs bookkeeping after the response (the route
 * passes the Worker's waitUntil); without it the call log is written before
 * returning (scripts, tests).
 */
export async function handleMcpPost(db: DB, req: Request, origin: string, defer?: (p: Promise<unknown>) => void): Promise<Response> {
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
  const logs: McpCallRow[] = [];
  for (const m of msgs) {
    const r = await handleRpc(db, id, m, origin, logs, defer);
    if (r) out.push(r);
  }
  if (logs.length) {
    const write = logCalls(db, logs);
    if (defer) defer(write);
    else await write;
  }
  if (out.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return json(Array.isArray(body) ? out : out[0]);
}

// What the AI Connector can read — a fixed catalogue of READ functions.
//
// Houzs Connect renders almost everything in server components and changes data
// through server actions; it has no general JSON read API to re-enter the way
// the ERPs' connectors do. So the connector does not call routes at all: each
// endpoint below is a SELECT-only function that runs as the real person and
// reuses the SAME permission-checked building blocks the app's own pages use:
//
//   - module access: lib/module-access.ts resolveModules + lib/full-access.ts
//     moduleChoices (Settings → Access), exactly what requireModule() checks;
//   - conversations: lib/inbox-group.ts inboxScopes + unifiedConversationWhere —
//     the inbox rail's own company + org-chart visibility predicate (and a
//     thread is only readable when it passes that predicate, which is stricter
//     than the thread page's company-only check);
//   - contacts: contacts/queries.ts contactsWhere + contactDetail (company scope);
//   - dashboard: dashboard/queries.ts; message log: logs/data.ts logRows.
//
// Nothing here imports a "use server" module (scripts/smoke-mcp.mjs checks the
// import list), so no server action is reachable from a connector token.

import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  automation,
  campaign,
  channel,
  company,
  contact,
  conversation,
  department,
  dripCampaign,
  member,
  message,
  note,
  payment,
  tag,
} from "@/db/schema";
import { attrs, displayName, mediaCaption } from "@/lib/format";
import { inboxScopes, unifiedConversationWhere } from "@/lib/inbox-group";
import type { Module } from "@/lib/module-access";
import type { CurrentMember } from "@/lib/current-member";
import { contactDetail, contactsWhere, type Segment } from "@/app/(app)/contacts/queries";
import { conversationStatus, messagesByAgent, messageVolume, replyStats, teamLoad } from "@/app/(app)/dashboard/queries";
import { klDayKey, parsePeriod, periodWindow } from "@/app/(app)/dashboard/util";
import { failureReasons, logRows, todayStats } from "@/app/(app)/logs/data";
import { SLA_MINUTES } from "@/lib/sla";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { ensureDripTables } from "@/db/ensure-drip";
import { intParam, matchPattern, strParam } from "./core";
import { searchResult, summariseInbox, summariseService, type InboxGroupRow, type SearchResult } from "./quick";
import {
  buildMoodScan,
  dayRange,
  maskPhone,
  MOOD_MAX_DAYS,
  MOOD_SCAN_REFUSAL,
  moodScanAllowed,
  myMidnight,
  myToday,
  shiftDay,
  summariseCampaigns,
  summariseDelivery,
  summariseReplySpeed,
  type MoodConversation,
  type WaitingRow,
} from "./round3";

/** The person a connector call runs as: their member row in the company they connected from. */
export type McpMember = CurrentMember;

/**
 * `memo` lives for ONE MCP request (server.ts makes it per POST): answers that
 * several reads of the same request need — the person's conversation scope —
 * are worked out once. Never shared between requests or people.
 */
export type ReadCtx = { db: DB; me: McpMember; modules: Module[]; memo?: Map<string, Promise<unknown>> };
type Query = Record<string, unknown>;

export class ReadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Endpoint = {
  path: string;
  module: Module;
  description: string;
  params?: Record<string, string>;
  run: (ctx: ReadCtx, p: Record<string, string>, q: Query) => Promise<unknown>;
};

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};
const like = (q: string) => `%${q.replace(/[%_\\]/g, "")}%`;

async function memberNames(db: DB, companyId: string): Promise<Map<string, string>> {
  const r = await db.select({ id: member.id, name: member.name }).from(member).where(eq(member.companyId, companyId));
  return new Map(r.map((m) => [m.id, m.name]));
}

const STATUSES = ["OPEN", "QUEUE", "PENDING", "CLOSED"];

async function computeScopeWhere(ctx: ReadCtx): Promise<SQL | undefined> {
  await ensureConversationMemberTable(ctx.db).catch(() => {});
  const scopes = await inboxScopes(ctx.db, ctx.me);
  return unifiedConversationWhere(ctx.db, scopes);
}

/** The inbox rail's visibility predicate for this person — once per request (search + a list + a thread share it). */
function conversationScopeWhere(ctx: ReadCtx): Promise<SQL | undefined> {
  if (!ctx.memo) return computeScopeWhere(ctx);
  let p = ctx.memo.get("scope") as Promise<SQL | undefined> | undefined;
  if (!p) {
    p = computeScopeWhere(ctx);
    p.catch(() => ctx.memo?.delete("scope")); // never keep a failure
    ctx.memo.set("scope", p);
  }
  return p;
}

/** The /conversations search: customer name, order refs, phone digits, or message text. */
function conversationMatch(term: string): SQL | undefined {
  if (!term) return undefined;
  const digits = term.replace(/\D/g, "");
  return or(
    sql`exists (select 1 from connect.contact c where c.id = ${conversation.contactId} and (
      c.name ilike ${like(term)}
      or exists (select 1 from jsonb_each_text(c.attributes) kv where kv.key like 'ref%' and kv.value ilike ${like(term)})
      ${digits.length >= 3 ? sql`or c.phone like ${`%${digits}%`}` : sql``}))`,
    sql`exists (select 1 from connect.message m where m.conversation_id = ${conversation.id} and m.body ilike ${like(term)})`
  );
}

/** Start of today and of the 7-day window ending today, Malaysian calendar days. */
function klWindows(now = new Date()) {
  const today = new Date(`${klDayKey(now)}T00:00:00+08:00`);
  return { today, week: new Date(today.getTime() - 6 * 86_400_000) };
}

export const ENDPOINTS: Endpoint[] = [
  // ── Quick answers (also tools: inbox_overview, service_performance) ──
  {
    path: "/inbox/overview",
    module: "inbox",
    description:
      "QUICK ANSWER — the Service inbox right now, as this person sees it: not-closed conversations by status, how many wait for our reply (last message from the customer), by channel and by person, the longest waits, and messages / new conversations / contacts added today and in the last 7 days.",
    run: inboxOverview,
  },
  {
    path: "/dashboard/service",
    module: "dashboard",
    description:
      "QUICK ANSWER — customer-service performance for a period: reply rate, average first reply and reply times (overall and by person), conversations by status, messages in / out against the period before. Same figures as the Dashboard.",
    params: { days: "7 | 30 | 90 (default 7)" },
    async run({ db, me }, _p, q) {
      const w = periodWindow(parsePeriod(strParam(q.days) || "7"));
      const [reply, status, volume, names] = await Promise.all([
        replyStats(me.companyId, w.since),
        conversationStatus(me.companyId, w),
        messageVolume(me.companyId, w),
        memberNames(db, me.companyId),
      ]);
      return summariseService({ days: w.days, label: w.rangeLabel }, reply, status, volume, names);
    },
  },
  // ── Round 3 quick answers (owner 2026-11-26). Listed BEFORE the :id
  // patterns so /contacts/summary is not read as a contact id. ──
  {
    path: "/dashboard/reply-speed",
    module: "dashboard",
    description:
      "QUICK ANSWER — how fast we reply: the Dashboard's own reply figures (avg first human reply, avg reply, reply rate) for today, yesterday and the last 7 days, per member, and the conversations waiting on us longer than the reply SLA (who, how long, assigned to).",
    async run({ db, me }) {
      const today = myToday();
      const t0 = myMidnight(today);
      const [rt, ry, rw, names, waiting] = await Promise.all([
        replyStats(me.companyId, t0),
        replyStats(me.companyId, myMidnight(shiftDay(today, -1)), t0),
        replyStats(me.companyId, myMidnight(shiftDay(today, -6))),
        memberNames(db, me.companyId),
        waitingOverSla(db, me.companyId),
      ]);
      return summariseReplySpeed({ today: rt, yesterday: ry, last7: rw }, names, waiting.rows, waiting.total);
    },
  },
  {
    path: "/logs/delivery",
    module: "logs",
    description: "QUICK ANSWER — message delivery: today's outbound messages by where they got to (sent / delivered / read / failed / waiting) and the failed ones of the last N days with Meta's reason.",
    params: { days: "failed messages of the last N days, 1-30 (default 7)" },
    async run({ me }, _p, q) {
      const days = intParam(q.days, 7, 1, 30);
      const CAP = 200;
      const [today, failed] = await Promise.all([
        todayStats(me.companyId),
        logRows(me.companyId, { q: "", status: "FAILED", direction: "OUT", type: "", days }, CAP),
      ]);
      const reasons = await failureReasons(failed.slice(0, 20));
      return summariseDelivery(
        today,
        failed.map((r) => ({ id: r.id, createdAt: r.createdAt, conversationId: r.conversationId, customer: displayName(r.name, r.phone), type: r.type, sendError: r.sendError })),
        reasons,
        days,
        CAP
      );
    },
  },
  {
    path: "/contacts/summary",
    module: "contacts",
    description: "QUICK ANSWER — customers (contacts) in numbers: total, with an open order, with a balance due, waiting, blocked, added today / last 7 days, and the most used tags.",
    async run({ db, me }) {
      const { today, week } = klWindows();
      const seg = (segment?: Segment) => db.$count(contact, contactsWhere(me.companyId, segment ? { segment } : {}));
      const mine = eq(contact.companyId, me.companyId);
      const [total, openOrder, balanceDue, waiting, blocked, added, tags] = await Promise.all([
        seg(),
        seg("open-order"),
        seg("balance-due"),
        seg("waiting"),
        seg("blocked"),
        db
          .select({
            today: sql<number>`count(*) filter (where ${contact.createdAt} >= ${today.toISOString()}::timestamptz)`.mapWith(Number),
            week: sql<number>`count(*)`.mapWith(Number),
          })
          .from(contact)
          .where(and(mine, sql`${contact.createdAt} >= ${week.toISOString()}::timestamptz`)),
        db
          .select({ name: tag.name, contacts: sql<number>`(select count(*) from connect.contact_tag ct where ct.tag_id = ${tag.id})`.mapWith(Number) })
          .from(tag)
          .where(eq(tag.companyId, me.companyId)),
      ]);
      return {
        total,
        segments: { openOrder, balanceDue, waiting, blocked },
        addedToday: added[0]?.today ?? 0,
        added7d: added[0]?.week ?? 0,
        topTags: tags.sort((a, b) => b.contacts - a.contacts).slice(0, 10),
        note: "Segments are the Contacts page's own filters.",
      };
    },
  },
  {
    path: "/campaigns/summary",
    module: "campaigns",
    description: "QUICK ANSWER — broadcast campaigns: how many by status, total audience / sent / failed, and the latest 10 with their numbers.",
    async run({ db, me }) {
      const rows = await db
        .select({ name: campaign.name, template: campaign.templateName, status: campaign.status, scheduleAt: campaign.scheduleAt, stats: campaign.stats, createdAt: campaign.createdAt })
        .from(campaign)
        .where(eq(campaign.companyId, me.companyId))
        .orderBy(desc(campaign.createdAt))
        .limit(200);
      return summariseCampaigns(rows as unknown as Record<string, unknown>[]);
    },
  },
  {
    path: "/inbox/mood-scan",
    module: "inbox",
    description:
      "SUPERVISORS AND ADMINS ONLY — customers' own messages of a day (or up to 7 days), grouped by conversation (most active first, clipped, at most 200 messages), with flags: unanswered messages in a row, waiting past the reply SLA, complaint keywords. For judging who is unhappy; summarise, do not repeat the messages.",
    params: { date: "YYYY-MM-DD (default today)", from: "YYYY-MM-DD", to: "YYYY-MM-DD (at most 7 days from from)" },
    run: moodScan,
  },
  // ── Service (inbox) ──
  {
    path: "/conversations",
    module: "inbox",
    description: "WhatsApp conversations this person can see in Service (same rule as their inbox list), newest first.",
    params: {
      q: "search customer name, phone, order number (SO / ref) or message text",
      status: "OPEN | QUEUE | PENDING | CLOSED",
      unread: "true = only unread",
      assigned: "me = only conversations assigned to this person",
      open: "true = only not closed",
      limit: "1-100 (default 20)",
      offset: "for paging",
    },
    async run(ctx, _p, q) {
      const { db } = ctx;
      const scope = await conversationScopeWhere(ctx);
      const status = strParam(q.status).toUpperCase();
      const match = conversationMatch(strParam(q.q));
      const limit = intParam(q.limit, 20, 1, 100);
      const rows = await db.query.conversation.findMany({
        where: and(
          scope,
          match,
          STATUSES.includes(status) ? sql`${conversation.status} = ${status}` : undefined,
          String(q.unread) === "true" ? sql`${conversation.unreadCount} > 0` : undefined,
          String(q.assigned) === "me" ? eq(conversation.assignedAgentId, ctx.me.id) : undefined,
          String(q.open) === "true" ? sql`${conversation.status} <> 'CLOSED'` : undefined
        ),
        orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
        limit: limit + 1,
        offset: intParam(q.offset, 0, 0, 5000),
        with: {
          contact: { columns: { name: true, phone: true, attributes: true } },
          assignedAgent: { columns: { name: true } },
          assignedDepartment: { columns: { name: true } },
          tagLinks: { with: { tag: { columns: { name: true } } } },
          messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit: 1, columns: { createdAt: true, direction: true, body: true, type: true } },
        },
      });
      const more = rows.length > limit;
      return {
        conversations: rows.slice(0, limit).map((c) => {
          const last = c.messages[0];
          const a = attrs(c.contact.attributes);
          return {
            id: c.id,
            customer: displayName(c.contact.name, c.contact.phone),
            phone: c.contact.phone,
            status: c.status,
            unread: c.unreadCount,
            assignedTo: c.assignedAgent?.name ?? null,
            department: c.assignedDepartment?.name ?? null,
            tags: c.tagLinks.map((t) => t.tag.name),
            orderRef: a.ref_1 || null,
            deliveryDate: a.delivery_date_1 || null,
            lastMessage: last ? { at: last.createdAt, from: last.direction === "IN" ? "customer" : "us", text: clip(mediaCaption(last.body) || `[${last.type.toLowerCase()}]`, 160) } : null,
            waitingOnUs: last?.direction === "IN",
          };
        }),
        hasMore: more,
      };
    },
  },
  {
    path: "/conversations/:id",
    module: "inbox",
    description: "One conversation: the customer, its order fields, and the latest messages and internal notes (only if this person can see it in Service).",
    params: { limit: "messages, 1-200 (default 30, the newest)" },
    async run(ctx, p, q) {
      const { db } = ctx;
      const scope = await conversationScopeWhere(ctx);
      const limit = intParam(q.limit, 30, 1, 200);
      const c = await db.query.conversation.findFirst({
        where: and(eq(conversation.id, p.id), scope),
        with: {
          contact: true,
          assignedAgent: { columns: { name: true } },
          assignedDepartment: { columns: { name: true } },
          tagLinks: { with: { tag: { columns: { name: true } } } },
          messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit },
        },
      });
      if (!c) throw new ReadError(404, "Conversation not found, or not one this person can see in Service.");
      const [notes, names] = await Promise.all([
        db.select({ createdAt: note.createdAt, memberId: note.memberId, body: note.body }).from(note).where(eq(note.conversationId, c.id)).orderBy(desc(note.createdAt)).limit(20),
        memberNames(db, c.contact.companyId),
      ]);
      return {
        id: c.id,
        status: c.status,
        assignedTo: c.assignedAgent?.name ?? null,
        department: c.assignedDepartment?.name ?? null,
        tags: c.tagLinks.map((t) => t.tag.name),
        customer: {
          id: c.contact.id,
          name: displayName(c.contact.name, c.contact.phone),
          phone: c.contact.phone,
          email: c.contact.email,
          blocked: c.contact.blocked,
          fields: attrs(c.contact.attributes),
        },
        messages: c.messages
          .slice()
          .reverse()
          .map((m) => ({
            at: m.createdAt,
            from: m.direction === "IN" ? "customer" : m.isBot ? "bot" : (names.get(m.sentByMemberId ?? "") ?? "us"),
            type: m.type,
            text: clip(mediaCaption(m.body) || (m.type === "TEXT" ? "" : `[${m.type.toLowerCase()}]`), 1000),
            status: m.direction === "OUT" ? m.status : undefined,
          })),
        internalNotes: notes.reverse().map((n) => ({ at: n.createdAt, by: names.get(n.memberId) ?? "—", text: clip(n.body, 1000) })),
      };
    },
  },
  // ── Contacts ──
  {
    path: "/contacts",
    module: "contacts",
    description: "Customers (contacts) of this company, most recently updated first.",
    params: {
      q: "name, email, phone or order number",
      segment: "open-order | balance-due | waiting | blocked",
      tag: "tag id (from /tags)",
      limit: "1-100 (default 20)",
      offset: "for paging",
    },
    async run({ db, me }, _p, q) {
      const term = strParam(q.q);
      const seg = strParam(q.segment) as Segment;
      const where = contactsWhere(me.companyId, {
        q: term || undefined,
        digits: /\d{3,}/.test(term) ? term.replace(/\D/g, "") : undefined,
        segment: (["open-order", "balance-due", "waiting", "blocked"] as string[]).includes(seg) ? seg : undefined,
        tagId: strParam(q.tag) || undefined,
      });
      const limit = intParam(q.limit, 20, 1, 100);
      const [total, rows] = await Promise.all([
        db.$count(contact, where),
        db.query.contact.findMany({
          where,
          orderBy: desc(contact.updatedAt),
          limit,
          offset: intParam(q.offset, 0, 0, 100_000),
          with: { tagLinks: { with: { tag: { columns: { name: true } } } } },
        }),
      ]);
      return {
        total,
        contacts: rows.map((c) => ({
          id: c.id,
          name: displayName(c.name, c.phone),
          phone: c.phone,
          email: c.email,
          source: c.source,
          blocked: c.blocked,
          tags: c.tagLinks.map((t) => t.tag.name),
          // The list keeps every field but clips long values; /contacts/:id has them whole.
          fields: Object.fromEntries(Object.entries(attrs(c.attributes)).map(([k, v]) => [k, typeof v === "string" ? clip(v, 80) : v])),
          updatedAt: c.updatedAt,
        })),
      };
    },
  },
  {
    path: "/contacts/:id",
    module: "contacts",
    description: "One customer: fields, tags and recent conversations.",
    async run({ me }, p) {
      const d = await contactDetail(me.companyId, p.id);
      if (!d) throw new ReadError(404, "Contact not found in this company.");
      const labels = new Map(d.fields.map((f) => [f.key, f.name]));
      const fields = attrs(d.c.attributes);
      return {
        id: d.c.id,
        name: displayName(d.c.name, d.c.phone),
        phone: d.c.phone,
        email: d.c.email,
        source: d.c.source,
        blocked: d.c.blocked,
        marketingOptIn: d.c.marketingOptIn,
        tags: d.c.tagLinks.map((t) => t.tag.name),
        fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [labels.get(k) ?? k, v])),
        recentConversations: d.convos.map((c) => ({
          id: c.id,
          status: c.status,
          department: c.assignedDepartment?.name ?? null,
          lastMessageAt: c.lastMessageAt,
          lastMessage: clip(mediaCaption(c.messages[0]?.body), 200),
        })),
        createdAt: d.c.createdAt,
        updatedAt: d.c.updatedAt,
      };
    },
  },
  {
    path: "/tags",
    module: "contacts",
    description: "Tags used on contacts, with how many contacts carry each.",
    async run({ db, me }) {
      const rows = await db
        .select({ id: tag.id, name: tag.name, contacts: sql<number>`(select count(*) from connect.contact_tag ct where ct.tag_id = ${tag.id})`.mapWith(Number) })
        .from(tag)
        .where(eq(tag.companyId, me.companyId))
        .orderBy(asc(tag.name));
      return { tags: rows };
    },
  },
  // ── Payments ──
  {
    path: "/payments",
    module: "payments",
    description: "Payment slips customers sent in chat, newest first, with counts by status.",
    params: { status: "PENDING | VERIFIED | REJECTED", q: "customer name, phone, order or reference number", limit: "1-100 (default 20)", offset: "for paging" },
    async run({ db, me }, _p, q) {
      const mine = eq(contact.companyId, me.companyId);
      const st = strParam(q.status).toUpperCase();
      const term = strParam(q.q);
      const digits = term.replace(/\D/g, "");
      const filter = and(
        mine,
        ["PENDING", "VERIFIED", "REJECTED"].includes(st) ? sql`${payment.status} = ${st}` : undefined,
        term
          ? or(
              ilike(contact.name, like(term)),
              ilike(payment.orderRef, like(term)),
              ilike(payment.referenceNo, like(term)),
              digits.length >= 3 ? sql`${contact.phone} like ${`%${digits}%`}` : undefined
            )
          : undefined
      );
      const [counts, rows] = await Promise.all([
        db
          .select({ status: payment.status, n: count() })
          .from(payment)
          .innerJoin(contact, eq(contact.id, payment.contactId))
          .where(mine)
          .groupBy(payment.status),
        db
          .select({
            id: payment.id,
            customer: contact.name,
            phone: contact.phone,
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            referenceNo: payment.referenceNo,
            orderRef: payment.orderRef,
            status: payment.status,
            createdAt: payment.createdAt,
            conversationId: payment.conversationId,
          })
          .from(payment)
          .innerJoin(contact, eq(contact.id, payment.contactId))
          .where(filter)
          .orderBy(desc(payment.createdAt))
          .limit(intParam(q.limit, 20, 1, 100))
          .offset(intParam(q.offset, 0, 0, 100_000)),
      ]);
      return { countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.n])), payments: rows };
    },
  },
  // ── Campaigns / automations / drips ──
  {
    path: "/campaigns",
    module: "campaigns",
    description: "Broadcast campaigns of this company with their status and delivery stats.",
    params: { limit: "1-100 (default 30)", offset: "for paging" },
    async run({ db, me }, _p, q) {
      const rows = await db
        .select({
          id: campaign.id,
          name: campaign.name,
          template: campaign.templateName,
          status: campaign.status,
          scheduleAt: campaign.scheduleAt,
          stats: campaign.stats,
          createdAt: campaign.createdAt,
        })
        .from(campaign)
        .where(eq(campaign.companyId, me.companyId))
        .orderBy(desc(campaign.createdAt))
        .limit(intParam(q.limit, 30, 1, 100))
        .offset(intParam(q.offset, 0, 0, 100_000));
      return { campaigns: rows };
    },
  },
  {
    path: "/automations",
    module: "automations",
    description: "Automations (WhatsApp flows) of this company: trigger, status, on/off.",
    async run({ db, me }) {
      const rows = await db
        .select({
          id: automation.id,
          name: automation.name,
          description: automation.description,
          trigger: automation.triggerType,
          status: automation.status,
          enabled: automation.enabled,
          version: automation.version,
          updatedAt: automation.updatedAt,
        })
        .from(automation)
        .where(eq(automation.companyId, me.companyId))
        .orderBy(asc(automation.name));
      return { automations: rows };
    },
  },
  {
    path: "/automations/:id",
    module: "automations",
    description: "One automation with its trigger settings and its steps (node list).",
    async run({ db, me }, p) {
      const a = await db.query.automation.findFirst({ where: and(eq(automation.id, p.id), eq(automation.companyId, me.companyId)) });
      if (!a) throw new ReadError(404, "Automation not found in this company.");
      const g = (a.graph ?? {}) as { nodes?: { id?: string; type?: string; data?: Record<string, unknown> }[] };
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        trigger: a.triggerType,
        triggerConfig: a.triggerConfig,
        status: a.status,
        enabled: a.enabled,
        version: a.version,
        steps: (g.nodes ?? []).slice(0, 200).map((n) => ({ id: n.id, type: n.type, data: n.data })),
        updatedAt: a.updatedAt,
      };
    },
  },
  {
    path: "/drip-campaigns",
    module: "drip",
    description: "Drip campaigns (timed message sequences) of this company.",
    async run({ db, me }) {
      await ensureDripTables(db).catch(() => {});
      const rows = await db
        .select({ id: dripCampaign.id, name: dripCampaign.name, status: dripCampaign.status, createdAt: dripCampaign.createdAt })
        .from(dripCampaign)
        .where(eq(dripCampaign.companyId, me.companyId))
        .orderBy(asc(dripCampaign.name));
      return { dripCampaigns: rows };
    },
  },
  // ── Dashboard / logs ──
  {
    path: "/dashboard/summary",
    module: "dashboard",
    description: "Service figures for a period: reply rate and times, conversation status, message volume, busiest team members.",
    params: { days: "7 | 30 | 90 (default 30)" },
    async run({ db, me }, _p, q) {
      const w = periodWindow(parsePeriod(strParam(q.days)));
      const [reply, status, volume, load, sent, names] = await Promise.all([
        replyStats(me.companyId, w.since),
        conversationStatus(me.companyId, w),
        messageVolume(me.companyId, w),
        teamLoad(me.companyId, w),
        messagesByAgent(me.companyId, w),
        memberNames(db, me.companyId),
      ]);
      return {
        period: { days: w.days, from: w.since, label: w.rangeLabel },
        replies: {
          customersWhoWrote: reply.asked,
          answered: reply.answered,
          answeredByAPerson: reply.answeredHuman,
          avgFirstReplySeconds: reply.avgFirst == null ? null : Math.round(reply.avgFirst),
          avgReplySeconds: reply.avgReply == null ? null : Math.round(reply.avgReply),
          measuredInBusinessHours: reply.businessHours,
          byPerson: [...reply.byAgent.entries()].map(([id, v]) => ({
            name: names.get(id) ?? "—",
            replies: v.all.length,
            avgReplySeconds: v.all.length ? Math.round(v.all.reduce((a, b) => a + b, 0) / v.all.length) : null,
          })),
        },
        conversationsByStatus: status,
        messages: { total: volume.total, previousPeriod: volume.prev },
        busiestAssignees: load.map((r) => ({ name: r.name, conversations: r.n })),
        mostMessagesSent: sent.map((r) => ({ name: r.name, sent: r.sent })),
      };
    },
  },
  {
    path: "/logs/messages",
    module: "logs",
    description: "Message history (System Logs): every message in and out, newest first.",
    params: {
      q: "customer name, phone or text",
      status: "QUEUED | SENT | DELIVERED | READ | FAILED",
      direction: "IN | OUT",
      days: "only the last N days (1-90)",
      limit: "1-200 (default 30)",
      offset: "for paging",
    },
    async run({ me }, _p, q) {
      const dir = strParam(q.direction).toUpperCase();
      const rows = await logRows(
        me.companyId,
        {
          q: strParam(q.q),
          status: strParam(q.status).toUpperCase().replace(/[^A-Z]/g, ""),
          direction: dir === "IN" || dir === "OUT" ? dir : "",
          type: "",
          days: q.days ? intParam(q.days, 7, 1, 90) : null,
        },
        intParam(q.limit, 30, 1, 200),
        intParam(q.offset, 0, 0, 100_000)
      );
      return {
        messages: rows.map((r) => ({
          at: r.createdAt,
          conversationId: r.conversationId,
          customer: displayName(r.name, r.phone),
          phone: r.phone,
          direction: r.direction,
          type: r.type,
          status: r.status,
          text: clip(r.body, 200),
          sendError: r.sendError,
        })),
      };
    },
  },
  {
    path: "/departments",
    module: "inbox",
    description: "Departments of this company (as used for assignment in Service).",
    async run({ db, me }) {
      const rows = await db
        .select({ id: department.id, name: department.name })
        .from(department)
        .where(eq(department.companyId, me.companyId))
        .orderBy(asc(department.name));
      return { departments: rows };
    },
  },
];

// ── quick answer: inbox overview ──────────────────────────────────────────

/** The direction of a conversation's newest message ('IN' = the customer wrote last). */
const lastDirection = sql`(select m.direction from connect.message m where m.conversation_id = ${conversation.id} order by m.created_at desc limit 1)`;

/**
 * Five aggregate queries, sent together on the request's one socket, all through
 * the inbox rail's own visibility predicate (contacts: company scope, and only
 * when the person has the contacts module). Replaces reading /conversations
 * page by page to count.
 */
async function inboxOverview(ctx: ReadCtx): Promise<unknown> {
  const { db, me } = ctx;
  const scope = await conversationScopeWhere(ctx);
  const { today, week } = klWindows();
  const notClosed = sql`${conversation.status} <> 'CLOSED'`;
  const waitingNow = sql`${lastDirection} = 'IN'`;
  const num = (q: SQL) => sql<number>`${q}`.mapWith(Number);
  const [groups, msgs, convos, contacts, waiting] = await Promise.all([
    db
      .select({
        status: conversation.status,
        channel: channel.displayName,
        agent: member.name,
        n: num(sql`count(*)`),
        unread: num(sql`count(*) filter (where ${conversation.unreadCount} > 0)`),
        waiting: num(sql`count(*) filter (where ${waitingNow})`),
        oldestWaitingAt: sql<Date | string | null>`min(${conversation.lastMessageAt}) filter (where ${waitingNow})`,
      })
      .from(conversation)
      .leftJoin(channel, eq(channel.id, conversation.channelId))
      .leftJoin(member, eq(member.id, conversation.assignedAgentId))
      .where(and(scope, notClosed))
      .groupBy(conversation.status, channel.displayName, member.name),
    db
      .select({
        inToday: num(sql`count(*) filter (where ${message.direction} = 'IN' and ${message.createdAt} >= ${today.toISOString()}::timestamptz)`),
        outToday: num(sql`count(*) filter (where ${message.direction} = 'OUT' and ${message.createdAt} >= ${today.toISOString()}::timestamptz)`),
        in7: num(sql`count(*) filter (where ${message.direction} = 'IN')`),
        out7: num(sql`count(*) filter (where ${message.direction} = 'OUT')`),
      })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .where(and(scope, sql`${message.createdAt} >= ${week.toISOString()}::timestamptz`)),
    db
      .select({
        today: num(sql`count(*) filter (where ${conversation.createdAt} >= ${today.toISOString()}::timestamptz)`),
        week: num(sql`count(*)`),
      })
      .from(conversation)
      .where(and(scope, sql`${conversation.createdAt} >= ${week.toISOString()}::timestamptz`)),
    ctx.modules.includes("contacts")
      ? db
          .select({
            today: num(sql`count(*) filter (where ${contact.createdAt} >= ${today.toISOString()}::timestamptz)`),
            week: num(sql`count(*)`),
          })
          .from(contact)
          .where(and(eq(contact.companyId, me.companyId), sql`${contact.createdAt} >= ${week.toISOString()}::timestamptz`))
      : Promise.resolve(null),
    db
      .select({
        id: conversation.id,
        name: contact.name,
        phone: contact.phone,
        assignedTo: member.name,
        channel: channel.displayName,
        since: conversation.lastMessageAt,
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .leftJoin(channel, eq(channel.id, conversation.channelId))
      .leftJoin(member, eq(member.id, conversation.assignedAgentId))
      .where(and(scope, notClosed, waitingNow))
      .orderBy(asc(conversation.lastMessageAt))
      .limit(5),
  ]);
  const m0 = msgs[0];
  const c0 = convos[0];
  const k0 = contacts?.[0];
  return summariseInbox(
    groups as InboxGroupRow[],
    {
      messagesInToday: m0?.inToday ?? 0,
      messagesOutToday: m0?.outToday ?? 0,
      messagesIn7d: m0?.in7 ?? 0,
      messagesOut7d: m0?.out7 ?? 0,
      newConversationsToday: c0?.today ?? 0,
      newConversations7d: c0?.week ?? 0,
      contactsAddedToday: contacts ? (k0?.today ?? 0) : null,
      contactsAdded7d: contacts ? (k0?.week ?? 0) : null,
    },
    waiting.map((w) => ({ id: w.id, customer: displayName(w.name, w.phone), assignedTo: w.assignedTo, channel: w.channel, since: w.since }))
  );
}


// ── customer_mood_scan (supervisors and admins only) ─────────────────────

/**
 * The range's inbound messages inside the inbox rail's visibility (a manager
 * without "see every chat" gets their own subtree), grouped for round3.ts
 * buildMoodScan. Gate first: Connect's admin roles and MANAGER only (owner
 * 2026-11-26). Phones are masked; message text is clipped.
 */
async function moodScan(ctx: ReadCtx, _p: Record<string, string>, q: Query): Promise<unknown> {
  if (!moodScanAllowed(ctx.me.role)) throw new ReadError(403, MOOD_SCAN_REFUSAL);
  const range = dayRange(q.from ?? q.date, q.to ?? q.date, MOOD_MAX_DAYS);
  if ("error" in range) throw new ReadError(400, range.error);
  const { db } = ctx;
  const scope = await conversationScopeWhere(ctx);
  const msgs = await db
    .select({ conversationId: message.conversationId, at: message.createdAt, body: message.body, type: message.type })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .where(and(scope, eq(message.direction, "IN"), sql`${message.createdAt} >= ${range.start.toISOString()}::timestamptz`, sql`${message.createdAt} < ${range.end.toISOString()}::timestamptz`))
    .orderBy(desc(message.createdAt))
    .limit(2000);
  const counts = new Map<string, number>();
  for (const m of msgs) counts.set(m.conversationId, (counts.get(m.conversationId) ?? 0) + 1);
  const ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([cid]) => cid);
  const convos = ids.length
    ? await db
        .select({
          id: conversation.id,
          status: conversation.status,
          name: contact.name,
          phone: contact.phone,
          agent: member.name,
          dept: department.name,
          channel: channel.displayName,
          lastReplyAt: sql<Date | string | null>`(select max(m.created_at) from connect.message m where m.conversation_id = ${conversation.id} and m.direction = 'OUT')`,
          lastAt: sql<Date | string | null>`(select max(m.created_at) from connect.message m where m.conversation_id = ${conversation.id})`,
          lastDir: lastDirection,
        })
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .leftJoin(member, eq(member.id, conversation.assignedAgentId))
        .leftJoin(department, eq(department.id, conversation.assignedDepartmentId))
        .leftJoin(channel, eq(channel.id, conversation.channelId))
        .where(inArray(conversation.id, ids))
    : [];
  const named = (n: string | null, phone: string) => {
    const t = (n ?? "").trim();
    return t && !/^\+?[\d\s-]+$/.test(t) ? t : maskPhone(phone);
  };
  const map = new Map<string, MoodConversation>(
    convos.map((c) => [
      c.id,
      {
        id: c.id,
        customer: named(c.name, c.phone),
        status: c.status,
        assignedTo: c.agent ?? null,
        department: c.dept ?? null,
        channel: c.channel ?? null,
        lastReplyAt: c.lastReplyAt,
        lastMessageAt: c.lastAt,
        lastFromCustomer: String(c.lastDir) === "IN",
      },
    ])
  );
  return buildMoodScan(
    msgs.map((m) => ({ conversationId: m.conversationId, at: m.at, text: mediaCaption(m.body) || "", type: m.type })),
    map,
    { from: range.from, to: range.to }
  );
}

/** Not closed, the customer wrote last, longer ago than SLA_MINUTES — company-wide, like the Dashboard's live panel. */
async function waitingOverSla(db: DB, companyId: string): Promise<{ total: number; rows: WaitingRow[] }> {
  const rows = (await db.execute(sql`
    select c.id, ct.name, ct.phone, mb.name as agent, d.name as dept, ch.display_name as channel, m.created_at as since,
      count(*) over () as total
    from connect.conversation c
    join connect.contact ct on ct.id = c.contact_id
    join lateral (
      select direction, created_at from connect.message
      where conversation_id = c.id order by created_at desc limit 1
    ) m on true
    left join connect.member mb on mb.id = c.assigned_agent_id
    left join connect.department d on d.id = c.assigned_department_id
    left join connect.channel ch on ch.id = c.channel_id
    where ct.company_id = ${companyId} and c.status <> 'CLOSED' and m.direction = 'IN'
      and m.created_at < now() - make_interval(mins => ${SLA_MINUTES})
    order by m.created_at asc
    limit 50
  `)) as unknown as { id: string; name: string | null; phone: string; agent: string | null; dept: string | null; channel: string | null; since: string | Date; total: string | number }[];
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({ id: r.id, customer: displayName(r.name, r.phone), assignedTo: r.agent, department: r.dept, channel: r.channel, since: r.since })),
  };
}

// ── search (ChatGPT's search tool) ────────────────────────────────────────

/**
 * Conversations (the inbox rail's visibility) and contacts (company scope) that
 * match a name, phone, order number or message text — only from the modules the
 * person has. Same predicates as /conversations?q= and /contacts?q=.
 */
export async function searchRecords(ctx: ReadCtx, query: unknown, origin: string): Promise<SearchResult[]> {
  const term = strParam(query, 100);
  if (!term) return [];
  const { db, me } = ctx;
  const [convos, people] = await Promise.all([
    ctx.modules.includes("inbox")
      ? conversationScopeWhere(ctx).then((scope) =>
          db.query.conversation.findMany({
            where: and(scope, conversationMatch(term)),
            orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
            limit: 10,
            columns: { id: true, status: true },
            with: { contact: { columns: { name: true, phone: true } }, assignedAgent: { columns: { name: true } } },
          })
        )
      : Promise.resolve([]),
    ctx.modules.includes("contacts")
      ? db.query.contact.findMany({
          where: contactsWhere(me.companyId, { q: term, digits: /\d{3,}/.test(term) ? term.replace(/\D/g, "") : undefined }),
          orderBy: desc(contact.updatedAt),
          limit: 10,
          columns: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
  ]);
  return [
    ...convos.map((c) =>
      searchResult(
        origin,
        "conversation",
        c.id,
        `Conversation: ${displayName(c.contact.name, c.contact.phone)} (${c.status.toLowerCase()}${c.assignedAgent?.name ? `, ${c.assignedAgent.name}` : ""})`
      )
    ),
    ...people.map((c) => searchResult(origin, "contact", c.id, `Contact: ${displayName(c.name, c.phone)} · ${c.phone}`)),
  ];
}

/** Find the endpoint for a concrete (already classified) path. */
export function findEndpoint(path: string): { ep: Endpoint; params: Record<string, string> } | null {
  for (const ep of ENDPOINTS) {
    const params = matchPattern(ep.path, path);
    if (params) return { ep, params };
  }
  return null;
}

/** The modules this person may read, with how many endpoints each has. */
export function moduleCatalog(modules: Module[]): { module: Module; endpoints: number }[] {
  const out = new Map<Module, number>();
  for (const ep of ENDPOINTS) if (modules.includes(ep.module)) out.set(ep.module, (out.get(ep.module) ?? 0) + 1);
  return [...out.entries()].map(([module, endpoints]) => ({ module, endpoints }));
}

/** Parameter-free list endpoints — what the leak check reads. */
export function listEndpointPaths(): string[] {
  return ENDPOINTS.filter((e) => !e.path.includes(":")).map((e) => e.path);
}

/** Company name for whoami. */
export async function companyName(db: DB, companyId: string): Promise<string> {
  const r = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1);
  return r[0]?.name ?? "";
}


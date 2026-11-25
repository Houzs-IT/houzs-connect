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

import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  automation,
  campaign,
  company,
  contact,
  conversation,
  department,
  dripCampaign,
  member,
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
import { parsePeriod, periodWindow } from "@/app/(app)/dashboard/util";
import { logRows } from "@/app/(app)/logs/data";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { ensureDripTables } from "@/db/ensure-drip";
import { intParam, matchPattern, strParam } from "./core";

/** The person a connector call runs as: their member row in the company they connected from. */
export type McpMember = CurrentMember;

export type ReadCtx = { db: DB; me: McpMember; modules: Module[] };
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

async function conversationScopeWhere(ctx: ReadCtx): Promise<SQL | undefined> {
  const scopes = await inboxScopes(ctx.db, ctx.me);
  return unifiedConversationWhere(ctx.db, scopes);
}

export const ENDPOINTS: Endpoint[] = [
  // ── Service (inbox) ──
  {
    path: "/conversations",
    module: "inbox",
    description: "WhatsApp conversations this person can see in Service (same rule as their inbox list), newest first.",
    params: {
      q: "search customer name, phone, order number (SO / ref) or message text",
      status: "OPEN | QUEUE | PENDING | CLOSED",
      unread: "true = only unread",
      limit: "1-100 (default 30)",
      offset: "for paging",
    },
    async run(ctx, _p, q) {
      const { db } = ctx;
      await ensureConversationMemberTable(db).catch(() => {});
      const scope = await conversationScopeWhere(ctx);
      const term = strParam(q.q);
      const digits = term.replace(/\D/g, "");
      const status = strParam(q.status).toUpperCase();
      const match = term
        ? or(
            sql`exists (select 1 from connect.contact c where c.id = ${conversation.contactId} and (
              c.name ilike ${like(term)}
              or exists (select 1 from jsonb_each_text(c.attributes) kv where kv.key like 'ref%' and kv.value ilike ${like(term)})
              ${digits.length >= 3 ? sql`or c.phone like ${`%${digits}%`}` : sql``}))`,
            sql`exists (select 1 from connect.message m where m.conversation_id = ${conversation.id} and m.body ilike ${like(term)})`
          )
        : undefined;
      const limit = intParam(q.limit, 30, 1, 100);
      const rows = await db.query.conversation.findMany({
        where: and(
          scope,
          match,
          STATUSES.includes(status) ? sql`${conversation.status} = ${status}` : undefined,
          String(q.unread) === "true" ? sql`${conversation.unreadCount} > 0` : undefined
        ),
        orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
        limit: limit + 1,
        offset: intParam(q.offset, 0, 0, 5000),
        with: {
          contact: true,
          assignedAgent: { columns: { name: true } },
          assignedDepartment: { columns: { name: true } },
          tagLinks: { with: { tag: { columns: { name: true } } } },
          messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit: 1 },
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
            lastMessage: last ? { at: last.createdAt, from: last.direction === "IN" ? "customer" : "us", text: clip(mediaCaption(last.body) || `[${last.type.toLowerCase()}]`, 200) } : null,
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
    params: { limit: "messages, 1-200 (default 50)" },
    async run(ctx, p, q) {
      const { db } = ctx;
      await ensureConversationMemberTable(db).catch(() => {});
      const scope = await conversationScopeWhere(ctx);
      const limit = intParam(q.limit, 50, 1, 200);
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
        db.select().from(note).where(eq(note.conversationId, c.id)).orderBy(desc(note.createdAt)).limit(50),
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
            text: clip(mediaCaption(m.body) || (m.type === "TEXT" ? "" : `[${m.type.toLowerCase()}]`), 2000),
            status: m.direction === "OUT" ? m.status : undefined,
          })),
        internalNotes: notes.reverse().map((n) => ({ at: n.createdAt, by: names.get(n.memberId) ?? "—", text: clip(n.body, 2000) })),
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
      limit: "1-100 (default 30)",
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
      const limit = intParam(q.limit, 30, 1, 100);
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
          fields: attrs(c.attributes),
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
    params: { status: "PENDING | VERIFIED | REJECTED", q: "customer name, phone, order or reference number", limit: "1-100 (default 30)" },
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
          .limit(intParam(q.limit, 30, 1, 100)),
      ]);
      return { countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c.n])), payments: rows };
    },
  },
  // ── Campaigns / automations / drips ──
  {
    path: "/campaigns",
    module: "campaigns",
    description: "Broadcast campaigns of this company with their status and delivery stats.",
    params: { limit: "1-100 (default 30)" },
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
        .limit(intParam(q.limit, 30, 1, 100));
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
      limit: "1-200 (default 50)",
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
        intParam(q.limit, 50, 1, 200)
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
          text: clip(r.body, 300),
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


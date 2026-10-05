import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  automationRun,
  channel,
  company,
  contact,
  conversation,
  department,
  driverEvent,
  member,
  message,
  payment,
} from "@/db/schema";
import { attrs } from "@/lib/format";
import { SLA_MINUTES } from "@/lib/sla";
import { companyPresence } from "@/lib/presence";
import type { PeriodWindow } from "./util";

/*
  Dashboard reads. Every query is scoped to ONE company: `conversation` and
  `message` carry no company_id, so they go through conversation → contact →
  company, the same join the inbox and the message log use. Nothing here is
  sampled or invented — a figure Connect has no source for is simply not shown.
*/

const dayExpr = (col: typeof message.createdAt | typeof conversation.createdAt) =>
  sql<string>`to_char(date_trunc('day', ${col} at time zone 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD')`;

const n = (q: ReturnType<typeof sql>) => sql<number>`${q}`.mapWith(Number);

/** Messages read to measure reply times in one window. */
const REPLY_SAMPLE = 20_000;

// ─────────────────────────── Reply times ───────────────────────────

export type ReplyStats = {
  /** Conversations where the customer wrote in the window. */
  asked: number;
  /** …of which got a reply after it. */
  answered: number;
  /** Average first-reply wait in seconds (answered only). */
  avgFirst: number | null;
  /** Average of every customer-message → next-reply gap, in seconds. */
  avgReply: number | null;
  /** Per assigned agent: first-reply and all-reply averages. */
  byAgent: Map<string, { first: number[]; all: number[] }>;
};

/**
 * Measured, not estimated: walks the window's messages in order. For each
 * conversation the first inbound starts the clock and the first outbound after
 * it stops it — automation replies count, as the customer saw them. Every later
 * "customer wrote → we answered" gap feeds the overall reply average.
 */
export async function replyStats(companyId: string, from: Date, to?: Date): Promise<ReplyStats> {
  const db = getDb();
  const rows = await db
    .select({
      conversationId: message.conversationId,
      direction: message.direction,
      createdAt: message.createdAt,
      agentId: conversation.assignedAgentId,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(
      and(
        eq(contact.companyId, companyId),
        gte(message.createdAt, from),
        to ? lt(message.createdAt, to) : undefined
      )
    )
    .orderBy(asc(message.createdAt))
    .limit(REPLY_SAMPLE);

  const firstIn = new Map<string, number>();
  const answeredFirst = new Set<string>();
  const pendingIn = new Map<string, number>();
  const firsts: number[] = [];
  const alls: number[] = [];
  const byAgent = new Map<string, { first: number[]; all: number[] }>();
  const agentOf = new Map<string, string | null>();

  for (const r of rows) {
    const at = r.createdAt.getTime();
    agentOf.set(r.conversationId, r.agentId);
    if (r.direction === "IN") {
      if (!firstIn.has(r.conversationId)) firstIn.set(r.conversationId, at);
      if (!pendingIn.has(r.conversationId)) pendingIn.set(r.conversationId, at);
      continue;
    }
    const waiting = pendingIn.get(r.conversationId);
    if (waiting == null) continue;
    pendingIn.delete(r.conversationId);
    const gap = (at - waiting) / 1000;
    alls.push(gap);
    const agent = r.agentId;
    const bucket = agent ? (byAgent.get(agent) ?? { first: [], all: [] }) : null;
    bucket?.all.push(gap);
    if (!answeredFirst.has(r.conversationId)) {
      answeredFirst.add(r.conversationId);
      const f = (at - (firstIn.get(r.conversationId) ?? at)) / 1000;
      firsts.push(f);
      bucket?.first.push(f);
    }
    if (agent && bucket) byAgent.set(agent, bucket);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    asked: firstIn.size,
    answered: answeredFirst.size,
    avgFirst: avg(firsts),
    avgReply: avg(alls),
    byAgent,
  };
}

// ─────────────────────────── Message volume ───────────────────────────

export async function messageVolume(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const day = dayExpr(message.createdAt);
  const [daily, prev] = await Promise.all([
    db
      .select({
        day,
        inbound: n(sql`count(*) filter (where ${message.direction} = 'IN')`),
        outbound: n(sql`count(*) filter (where ${message.direction} = 'OUT')`),
      })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(and(eq(contact.companyId, companyId), gte(message.createdAt, w.since)))
      .groupBy(day),
    db
      .select({
        inbound: n(sql`count(*) filter (where ${message.direction} = 'IN')`),
        outbound: n(sql`count(*) filter (where ${message.direction} = 'OUT')`),
      })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(
        and(
          eq(contact.companyId, companyId),
          gte(message.createdAt, w.prevSince),
          lt(message.createdAt, w.since)
        )
      ),
  ]);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series = w.buckets.map((b) => byDay.get(b.key) ?? { inbound: 0, outbound: 0 });
  const total = series.reduce(
    (a, d) => ({ inbound: a.inbound + d.inbound, outbound: a.outbound + d.outbound }),
    { inbound: 0, outbound: 0 }
  );
  return { series, total, prev: prev[0] ?? { inbound: 0, outbound: 0 } };
}

/** Outbound messages per team member in the window (bots excluded). */
export async function messagesByAgent(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const rows = await db
    .select({ memberId: message.sentByMemberId, sent: count() })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(
      and(
        eq(contact.companyId, companyId),
        eq(message.direction, "OUT"),
        isNotNull(message.sentByMemberId),
        gte(message.createdAt, w.since)
      )
    )
    .groupBy(message.sentByMemberId)
    .orderBy(desc(count()))
    .limit(8);
  const names = await memberNames(companyId);
  return rows.map((r) => ({ memberId: r.memberId, name: names.get(r.memberId ?? "") ?? "—", sent: r.sent }));
}

// ─────────────────────────── Conversations ───────────────────────────

/** Status split of conversations that had any activity in the window. */
export async function conversationStatus(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const rows = await db
    .select({ status: conversation.status, n: count() })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(and(eq(contact.companyId, companyId), gte(conversation.lastMessageAt, w.since)))
    .groupBy(conversation.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const total = rows.reduce((a, r) => a + r.n, 0);
  return { total, by };
}

/** Conversations handled per member: assigned conversations active in the window. */
export async function teamLoad(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const rows = await db
    .select({ agentId: conversation.assignedAgentId, n: count() })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(
      and(
        eq(contact.companyId, companyId),
        isNotNull(conversation.assignedAgentId),
        gte(conversation.lastMessageAt, w.since)
      )
    )
    .groupBy(conversation.assignedAgentId)
    .orderBy(desc(count()))
    .limit(5);
  const names = await memberNames(companyId);
  return rows.map((r) => ({ id: r.agentId ?? "", name: names.get(r.agentId ?? "") ?? "—", n: r.n }));
}

/** Support KPIs + daily series: conversations STARTED in the window. */
export async function supportStats(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const day = dayExpr(conversation.createdAt);
  const agg = (from: Date, to?: Date) =>
    db
      .select({
        total: count(),
        open: n(sql`count(*) filter (where ${conversation.status} = 'OPEN')`),
        closed: n(sql`count(*) filter (where ${conversation.status} = 'CLOSED')`),
        queue: n(sql`count(*) filter (where ${conversation.status} = 'QUEUE')`),
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(
        and(
          eq(contact.companyId, companyId),
          gte(conversation.createdAt, from),
          to ? lt(conversation.createdAt, to) : undefined
        )
      );
  const [[cur], [prev], daily] = await Promise.all([
    agg(w.since),
    agg(w.prevSince, w.since),
    db
      .select({
        day,
        total: count(),
        assigned: n(sql`count(*) filter (where ${conversation.assignedAgentId} is not null)`),
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(and(eq(contact.companyId, companyId), gte(conversation.createdAt, w.since)))
      .groupBy(day),
  ]);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  return {
    cur,
    prev,
    series: w.buckets.map((b) => byDay.get(b.key) ?? { total: 0, assigned: 0 }),
  };
}

/** One row per active member: conversations in the window + reply times. */
export async function agentsReport(companyId: string, w: PeriodWindow, deptId?: string) {
  const db = getDb();
  const [members, depts, rows, replies] = await Promise.all([
    db.query.member.findMany({
      where: and(
        eq(member.companyId, companyId),
        eq(member.active, true),
        deptId ? eq(member.departmentId, deptId) : undefined
      ),
      columns: { id: true, name: true, departmentId: true },
      orderBy: asc(member.name),
    }),
    db.query.department.findMany({
      where: eq(department.companyId, companyId),
      columns: { id: true, name: true },
      orderBy: asc(department.name),
    }),
    db
      .select({
        agentId: conversation.assignedAgentId,
        assigned: count(),
        open: n(sql`count(*) filter (where ${conversation.status} = 'OPEN')`),
        closed: n(sql`count(*) filter (where ${conversation.status} = 'CLOSED')`),
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(
        and(
          eq(contact.companyId, companyId),
          isNotNull(conversation.assignedAgentId),
          gte(conversation.lastMessageAt, w.since)
        )
      )
      .groupBy(conversation.assignedAgentId),
    replyStats(companyId, w.since),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const byAgent = new Map(rows.map((r) => [r.agentId, r]));
  const avg = (xs?: number[]) => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const list = members
    .map((m) => {
      const r = byAgent.get(m.id);
      const rt = replies.byAgent.get(m.id);
      const first = avg(rt?.first);
      return {
        id: m.id,
        name: m.name,
        dept: m.departmentId ? (deptName.get(m.departmentId) ?? null) : null,
        assigned: r?.assigned ?? 0,
        open: r?.open ?? 0,
        closed: r?.closed ?? 0,
        first,
        onTime: first == null ? null : first <= SLA_MINUTES * 60,
        avg: avg(rt?.all),
      };
    })
    .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
  return { list, depts };
}

// ─────────────────────────── Delivery follow-up ───────────────────────────

/**
 * The order follow-up flow — the automation the ERP order event starts
 * (trigger WEBHOOK) with the most runs this period. Its outcome is read from
 * the attributes the flow itself writes (seed: delivery_message_status_1,
 * tms_status, delivery_confirmation).
 */
export async function deliveryFollowUp(companyId: string, w: PeriodWindow) {
  const db = getDb();
  const top = await db
    .select({ id: automation.id, name: automation.name, runs: count() })
    .from(automationRun)
    .innerJoin(automation, eq(automation.id, automationRun.automationId))
    .where(
      and(
        eq(automation.companyId, companyId),
        eq(automation.triggerType, "WEBHOOK"),
        gte(automationRun.createdAt, w.since)
      )
    )
    .groupBy(automation.id, automation.name)
    .orderBy(desc(count()))
    .limit(1);
  // No runs this period: still name the flow (the company's ERP-triggered
  // automation), so the card keeps its shape and reads zeros.
  const flow =
    top[0] ??
    (await db.query.automation.findFirst({
      where: and(eq(automation.companyId, companyId), eq(automation.triggerType, "WEBHOOK")),
      columns: { id: true, name: true },
    }));
  if (!flow) return null;

  const runs = await db
    .select({
      contactId: automationRun.contactId,
      status: automationRun.status,
      updatedAt: automationRun.updatedAt,
    })
    .from(automationRun)
    .where(and(eq(automationRun.automationId, flow.id), gte(automationRun.createdAt, w.since)))
    .orderBy(desc(automationRun.createdAt))
    .limit(5000);

  const contactIds = [...new Set(runs.map((r) => r.contactId).filter((x): x is string => !!x))];
  const contacts = contactIds.length
    ? await db.query.contact.findMany({
        where: inArray(contact.id, contactIds.slice(0, 2000)),
        columns: { id: true, name: true, phone: true, attributes: true },
      })
    : [];
  const byId = new Map(contacts.map((c) => [c.id, { ...c, a: attrs(c.attributes) }]));
  const is = (v: string | undefined, re: RegExp) => !!v && re.test(v);

  let confirmed = 0;
  let rescheduled = 0;
  let delivered = 0;
  let issue = 0;
  for (const c of byId.values()) {
    if (is(c.a.delivery_message_status_1, /done|confirm/i)) confirmed++;
    if (is(c.a.delivery_message_status_1, /reschedul|amend/i)) rescheduled++;
    if (is(c.a.tms_status, /deliver/i)) delivered++;
    if (is(c.a.delivery_confirmation, /issue/i)) issue++;
  }

  const waiting = runs.filter((r) => r.status === "waiting");
  const dayAgo = Date.now() - 86_400_000;
  const stale = waiting
    .filter((r) => r.updatedAt.getTime() < dayAgo && r.contactId)
    .slice(0, 5)
    .map((r) => {
      const c = byId.get(r.contactId!);
      return {
        contactId: r.contactId!,
        ref: c?.a.ref_1 ?? null,
        name: c?.name ?? c?.phone ?? "—",
        sales: c?.a.sales_person ?? null,
        hours: Math.floor((Date.now() - r.updatedAt.getTime()) / 3_600_000),
      };
    });

  const receipts = await db
    .select({ n: count() })
    .from(payment)
    .innerJoin(contact, eq(contact.id, payment.contactId))
    .where(and(eq(contact.companyId, companyId), gte(payment.createdAt, w.since)));

  return {
    automationId: flow.id,
    name: flow.name,
    notified: contactIds.length,
    confirmed,
    noReply: new Set(waiting.map((r) => r.contactId)).size,
    rescheduled,
    delivered,
    issue,
    receipts: receipts[0]?.n ?? 0,
    stale,
  };
}

/** Find the open conversation for a contact, for "waiting over 24h" links. */
export async function conversationIdsFor(contactIds: string[]) {
  if (!contactIds.length) return new Map<string, string>();
  const db = getDb();
  const rows = await db
    .select({ id: conversation.id, contactId: conversation.contactId })
    .from(conversation)
    .where(inArray(conversation.contactId, contactIds))
    .orderBy(desc(conversation.lastMessageAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.contactId)) out.set(r.contactId, r.id);
  return out;
}

// ─────────────────────────── Connected accounts ───────────────────────────

export async function connectedAccounts(companyId: string) {
  const db = getDb();
  const todayStart = new Date(
    `${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" })}T00:00:00+08:00`
  );
  const [numbers, co, driver] = await Promise.all([
    db.query.channel.findMany({
      where: eq(channel.companyId, companyId),
      columns: { id: true, phone: true, displayName: true, phoneNumberId: true },
    }),
    db.query.company.findFirst({
      where: eq(company.id, companyId),
      columns: { name: true, erpCompanyId: true },
    }),
    db
      .select({ n: count() })
      .from(driverEvent)
      .innerJoin(contact, eq(contact.id, driverEvent.contactId))
      .where(and(eq(contact.companyId, companyId), gte(driverEvent.createdAt, todayStart))),
  ]);
  return {
    companyName: co?.name ?? "",
    live: process.env.WHATSAPP_MODE === "LIVE",
    numbers,
    erpSynced: co?.erpCompanyId != null,
    driverToday: driver[0]?.n ?? 0,
  };
}

// ─────────────────────────── Live ───────────────────────────

export async function liveNow(companyId: string) {
  const db = getDb();
  const mine = eq(contact.companyId, companyId);

  const [openNow, waitingRows, botRuns, people, recentMsgs, recentRuns, recentPays] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(and(mine, ne(conversation.status, "CLOSED"))),
      // Open conversations whose newest message is the customer's: waiting on us.
      db.execute(sql`
        select c.id, ct.name, ct.phone, ct.attributes, m.created_at as since
        from connect.conversation c
        join connect.contact ct on ct.id = c.contact_id
        join lateral (
          select direction, created_at from connect.message
          where conversation_id = c.id order by created_at desc limit 1
        ) m on true
        where ct.company_id = ${companyId} and c.status <> 'CLOSED' and m.direction = 'IN'
        order by m.created_at asc
        limit 200
      `),
      db
        .select({ n: count() })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(and(eq(automation.companyId, companyId), eq(automationRun.status, "waiting"))),
      companyPresence(companyId),
      db
        .select({
          id: message.id,
          body: message.body,
          direction: message.direction,
          isBot: message.isBot,
          memberId: message.sentByMemberId,
          createdAt: message.createdAt,
          conversationId: message.conversationId,
          name: contact.name,
          phone: contact.phone,
        })
        .from(message)
        .innerJoin(conversation, eq(conversation.id, message.conversationId))
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(mine)
        .orderBy(desc(message.createdAt))
        .limit(12),
      db
        .select({
          id: automationRun.id,
          status: automationRun.status,
          name: automation.name,
          at: automationRun.updatedAt,
        })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(eq(automation.companyId, companyId))
        .orderBy(desc(automationRun.updatedAt))
        .limit(6),
      db
        .select({
          id: payment.id,
          amount: payment.amount,
          status: payment.status,
          name: contact.name,
          at: payment.createdAt,
        })
        .from(payment)
        .innerJoin(contact, eq(contact.id, payment.contactId))
        .where(mine)
        .orderBy(desc(payment.createdAt))
        .limit(4),
    ]);

  const names = await memberNames(companyId);
  const waiting = (waitingRows as unknown as {
    id: string;
    name: string | null;
    phone: string;
    attributes: unknown;
    since: string | Date;
  }[]).map((r) => ({
    id: r.id,
    name: r.name ?? r.phone,
    ref: attrs(r.attributes).ref_1 ?? null,
    since: new Date(r.since),
  }));

  return {
    /** The clock this snapshot was taken at — renderers measure waits from it. */
    now: Date.now(),
    onlineAgents: people.filter((p) => p.online).length,
    openNow: openNow[0]?.n ?? 0,
    waitingCount: waiting.length,
    waiting: waiting.slice(0, 6),
    botHandling: botRuns[0]?.n ?? 0,
    // Online first, then most recently seen (companyPresence orders them).
    people: [...people].sort((a, b) => Number(b.online) - Number(a.online)),
    feed: [
      ...recentMsgs.map((m) => ({
        id: `m-${m.id}`,
        kind: (m.direction === "IN" ? "in" : m.isBot ? "bot" : "out") as "in" | "out" | "bot",
        text: (m.body ?? "").slice(0, 120),
        who: m.direction === "IN" ? (m.name ?? m.phone) : m.isBot ? "Bot" : (names.get(m.memberId ?? "") ?? "—"),
        to: m.name ?? m.phone,
        href: `/inbox/${m.conversationId}`,
        at: m.createdAt,
      })),
      ...recentRuns.map((r) => ({
        id: `r-${r.id}`,
        kind: "flow" as const,
        text: r.name,
        who: r.status,
        to: "",
        href: "",
        at: r.at,
      })),
      ...recentPays.map((p) => ({
        id: `p-${p.id}`,
        kind: "pay" as const,
        text: p.amount != null ? `RM ${p.amount.toFixed(2)}` : "",
        who: p.name ?? "",
        to: p.status,
        href: "/payments",
        at: p.at,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12),
  };
}

// ─────────────────────────── helpers ───────────────────────────

async function memberNames(companyId: string) {
  const db = getDb();
  const rows = await db.query.member.findMany({
    where: eq(member.companyId, companyId),
    columns: { id: true, name: true },
  });
  return new Map(rows.map((m) => [m.id, m.name]));
}

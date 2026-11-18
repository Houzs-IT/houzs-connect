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
import { ensureConversationClosedAt } from "@/db/ensure-conversation-closed-at";
import { loadBusinessHours, elapsedSeconds, hasBusinessHours } from "@/lib/business-hours";
import { klDayKey, type PeriodWindow } from "./util";

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
  /** …of which got ANY reply after it (bot or human) — the reply rate. */
  answered: number;
  /** …of which got a HUMAN reply — the sample behind the first-reply average. */
  answeredHuman: number;
  /** Average first-reply wait in seconds, to the first HUMAN reply. */
  avgFirst: number | null;
  /** Average of every customer-message → next-human-reply gap, in seconds. */
  avgReply: number | null;
  /** Per sending member (whoever actually replied): first-reply and all-reply averages (human-only). */
  byAgent: Map<string, { first: number[]; all: number[] }>;
  /** True when timing was measured in business-open hours (company has hours set). */
  businessHours: boolean;
};

/**
 * Measured, not estimated: walks the window's messages in order. For each
 * conversation the first inbound starts the clock and the first HUMAN outbound
 * (isBot=false) stops it — bot / automation / flow sends (the category menu, an
 * auto-reply) do NOT, so the figure is time-to-a-person, not time-to-a-machine.
 * Every "customer wrote → next human reply" gap feeds the overall reply average.
 * The reply RATE (asked / answered) still counts ANY reply, bot or human.
 * Timing is in business-open seconds when the company has hours configured
 * (reused from the auto-reply settings), else plain wall-clock.
 */
export async function replyStats(companyId: string, from: Date, to?: Date): Promise<ReplyStats> {
  const db = getDb();
  const cfg = await loadBusinessHours(db, companyId);
  const rows = await db
    .select({
      conversationId: message.conversationId,
      direction: message.direction,
      createdAt: message.createdAt,
      senderId: message.sentByMemberId,
      isBot: message.isBot,
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
  const answeredAny = new Set<string>(); // got ANY reply — the reply RATE (bot or human)
  const answeredHuman = new Set<string>(); // got a HUMAN first reply — the FRT timing
  const pendingIn = new Map<string, number>(); // earliest inbound awaiting a HUMAN reply
  const firsts: number[] = [];
  const alls: number[] = [];
  const byAgent = new Map<string, { first: number[]; all: number[] }>();

  for (const r of rows) {
    const at = r.createdAt.getTime();
    if (r.direction === "IN") {
      if (!firstIn.has(r.conversationId)) firstIn.set(r.conversationId, at);
      if (!pendingIn.has(r.conversationId)) pendingIn.set(r.conversationId, at);
      continue;
    }
    // Reply RATE counts ANY outbound after the customer wrote (bot or human) — so
    // a bot-handled chat still counts as answered. Timing below is human-only.
    if (firstIn.has(r.conversationId)) answeredAny.add(r.conversationId);
    // TIMING is human-only: a bot / automation / flow send (the category menu, an
    // auto-reply, a template push) must NOT stop the clock. The menu fires on
    // NEW_INCOMING_MESSAGE and goes out within seconds, so counting it would
    // collapse AVG FIRST REPLY to ~0 (time-to-menu, not time-to-human). `isBot`
    // is the reliable signal — since HC-0232 a bot send can also carry a
    // sentByMemberId (the staff who pressed Send in the ERP), so that is NOT it.
    if (r.isBot) continue;
    const waiting = pendingIn.get(r.conversationId);
    if (waiting == null) continue;
    pendingIn.delete(r.conversationId);
    // elapsedSeconds = business-open seconds when the company has hours set, else
    // wall-clock — so an overnight gap counts only the in-hours part.
    const gap = elapsedSeconds(waiting, at, cfg);
    alls.push(gap);
    // Credit the reply to the member who actually SENT it (sentByMemberId), not
    // the conversation's assignee — a shared inbox replies on unassigned threads,
    // so attributing by assignee hid everyone but the few with chats assigned.
    const agent = r.senderId;
    const bucket = agent ? (byAgent.get(agent) ?? { first: [], all: [] }) : null;
    bucket?.all.push(gap);
    if (!answeredHuman.has(r.conversationId)) {
      answeredHuman.add(r.conversationId);
      const f = elapsedSeconds(firstIn.get(r.conversationId) ?? at, at, cfg);
      firsts.push(f);
      bucket?.first.push(f);
    }
    if (agent && bucket) byAgent.set(agent, bucket);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    asked: firstIn.size,
    answered: answeredAny.size,
    answeredHuman: answeredHuman.size,
    avgFirst: avg(firsts),
    avgReply: avg(alls),
    byAgent,
    businessHours: hasBusinessHours(cfg),
  };
}

/**
 * Average first-reply time per Malaysian calendar day, aligned to w.buckets, in
 * MINUTES (0 for a day with no measured first reply). Same measurement as
 * replyStats (first inbound -> first outbound, automations included), bucketed
 * by the day of the customer's first message so the dashboard can show the
 * trend, not just one headline number. Its own message walk so replyStats — the
 * load-bearing FRT query — stays untouched.
 */
export async function firstReplySeries(companyId: string, w: PeriodWindow): Promise<number[]> {
  const db = getDb();
  const cfg = await loadBusinessHours(db, companyId);
  const rows = await db
    .select({
      conversationId: message.conversationId,
      direction: message.direction,
      createdAt: message.createdAt,
      isBot: message.isBot,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(and(eq(contact.companyId, companyId), gte(message.createdAt, w.since)))
    .orderBy(asc(message.createdAt))
    .limit(REPLY_SAMPLE);

  const firstIn = new Map<string, number>();
  const answered = new Set<string>();
  const byDay = new Map<string, number[]>(); // KL day -> first-reply seconds
  for (const r of rows) {
    const at = r.createdAt.getTime();
    if (r.direction === "IN") {
      if (!firstIn.has(r.conversationId)) firstIn.set(r.conversationId, at);
      continue;
    }
    // Human-only + same clock as the headline FRT: skip bot/menu/auto-reply sends.
    if (r.isBot) continue;
    const start = firstIn.get(r.conversationId);
    if (start == null || answered.has(r.conversationId)) continue;
    answered.add(r.conversationId);
    const day = klDayKey(new Date(start)); // bucket by the customer's first message day
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(elapsedSeconds(start, at, cfg));
  }

  return w.buckets.map((b) => {
    const xs = byDay.get(b.key);
    if (!xs || xs.length === 0) return 0;
    return xs.reduce((a, s) => a + s, 0) / xs.length / 60; // seconds -> minutes
  });
}

/**
 * Resolution time (conversation created -> closed) over closures in the window.
 * Reads `closed_at` (ensure-conversation-closed-at.ts; raw SQL, not in the
 * Drizzle schema). Forward-only: conversations closed before that column existed
 * have NULL closed_at and are not counted, so a bulk import of already-"CLOSED"
 * rows (which carry no closed_at) never pollutes this average.
 */
export async function resolutionStats(
  companyId: string,
  from: Date,
  to?: Date
): Promise<{ avgSec: number | null; n: number }> {
  const db = getDb();
  await ensureConversationClosedAt(db);
  const cfg = await loadBusinessHours(db, companyId);
  // Fetch the window's closures and average in JS so the business-hours clock
  // (which SQL can't express) applies — same clock as first-reply / avg-reply.
  // Capped like the reply walk; closures per window are bounded by throughput.
  // Bind the window bounds as ISO strings, NOT Date objects: this is a raw
  // db.execute, so Drizzle sends each param straight to postgres.js with no
  // column-type encoder. Under our pooler config (prepare:false, fetch_types:
  // false — see db/pg.ts) postgres.js has no serializer for a bare Date and
  // throws "Received an instance of Date" at Bind, 500-ing the whole Support
  // tab. A string is cast to timestamptz server-side. (db.select() paths are
  // unaffected — they encode the Date via the column type before postgres.js.)
  const rows = (await db.execute(sql`
    select c.created_at, c.closed_at
    from connect.conversation c
    join connect.contact ct on ct.id = c.contact_id
    where ct.company_id = ${companyId}
      and c.closed_at is not null
      and c.closed_at >= ${from.toISOString()}
      ${to ? sql`and c.closed_at < ${to.toISOString()}` : sql``}
    limit ${REPLY_SAMPLE}
  `)) as unknown as { created_at: string | Date; closed_at: string | Date }[];
  if (!rows.length) return { avgSec: null, n: 0 };
  let sum = 0;
  for (const r of rows) {
    sum += elapsedSeconds(new Date(r.created_at).getTime(), new Date(r.closed_at).getTime(), cfg);
  }
  return { avgSec: sum / rows.length, n: rows.length };
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
        // ERP-started bot sends now carry the staff member who pressed Send (HC-0232).
        eq(message.isBot, false),
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
  const [members, depts, rows, sends, replies] = await Promise.all([
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
    // Human replies the member actually SENT in the window (uncapped SQL count,
    // not the sampled walk) — the plain "how much did they reply" figure, which
    // the assigned/open/closed columns miss for a shared inbox.
    db
      .select({ memberId: message.sentByMemberId, replied: count() })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(
        and(
          eq(contact.companyId, companyId),
          eq(message.direction, "OUT"),
          eq(message.isBot, false),
          isNotNull(message.sentByMemberId),
          gte(message.createdAt, w.since)
        )
      )
      .groupBy(message.sentByMemberId),
    replyStats(companyId, w.since),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const byAgent = new Map(rows.map((r) => [r.agentId, r]));
  const repliedBy = new Map(sends.map((r) => [r.memberId, Number(r.replied)]));
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
        replied: repliedBy.get(m.id) ?? 0,
        first,
        onTime: first == null ? null : first <= SLA_MINUTES * 60,
        avg: avg(rt?.all),
      };
    })
    .sort((a, b) => b.replied - a.replied || b.assigned - a.assigned || a.name.localeCompare(b.name));
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

import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  automationRun,
  contact,
  contactTag,
  conversation,
  member,
  message,
  tag,
} from "@/db/schema";
import { relTime } from "@/lib/format";
import { Skel } from "@/components/skeleton";
import { LineChart } from "./charts";
import { BarRow, Card, Legend, NoData, Pill, Stat } from "./ui";
import { humanDuration, maxReach, pctOf, reportWindow } from "./util";

/*
  Streamed dashboard sections.

  The page's cheap counters (a couple of aggregate round-trips) resolve before
  the first byte, so the shell, the tab strip and every KPI tile paint straight
  away. The sections below are the ones that actually scan rows — a grouped
  per-agent aggregate, tag reach across the contact↔tag join, the activity feed,
  the seven-day message series and the reply-speed sample — so each one gets its
  own `<Suspense>` boundary and streams in behind a skeleton the same size as the
  card it replaces.

  Each section owns its query. They are siblings under separate boundaries, so
  they still run concurrently — this is a fan-out, not a waterfall.

  EVERY query here is scoped to one company. `conversation` and `message` carry
  no company_id of their own, so they are scoped through
  conversation → contact → company, the same join the inbox and the message log
  use.
*/

// ─────────────────────── Support · per-agent load ───────────────────────

export async function AgentLoadSection({
  companyId,
  unassignedOpen,
}: {
  companyId: string;
  unassignedOpen: number;
}) {
  const db = getDb();
  const [agentRows, membersList] = await Promise.all([
    db
      .select({
        agentId: conversation.assignedAgentId,
        total: count(),
        open: sql<number>`count(*) filter (where ${conversation.status} = 'OPEN')`.mapWith(
          Number
        ),
      })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(and(eq(contact.companyId, companyId), isNotNull(conversation.assignedAgentId)))
      .groupBy(conversation.assignedAgentId),
    db
      .select({ id: member.id, name: member.name })
      .from(member)
      .where(eq(member.companyId, companyId)),
  ]);

  const nameById = new Map(membersList.map((m) => [m.id, m.name]));
  const agents = agentRows
    .map((r) => ({
      name: (r.agentId && nameById.get(r.agentId)) || "Unknown agent",
      open: r.open,
      total: r.total,
    }))
    .sort((a, b) => b.open - a.open || b.total - a.total)
    .slice(0, 8);

  return (
    <Card title="Who is handling the chats" meta={<Pill kind="real" />}>
      {agents.length === 0 && unassignedOpen === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">
          No conversations assigned yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {agents.map((a) => (
            <div key={a.name} className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--color-ink)]">{a.name}</span>
              <span className="font-mono text-[12px] text-[var(--color-muted)]">
                {a.open} open · {a.total} total
              </span>
            </div>
          ))}
          {unassignedOpen > 0 && (
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[var(--color-faint)]">Nobody assigned</span>
              <span className="font-mono text-[12px] text-[var(--color-muted)]">
                {unassignedOpen} open
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function AgentLoadSkeleton() {
  return (
    <Card title="Who is handling the chats" meta={<Pill kind="real" />}>
      <div className="skeleton-stagger flex flex-col gap-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[14px] w-32" />
            <Skel className="h-[13px] w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────── Support · reply speed ───────────────────────

/** Messages read to measure reply speed. Seven days of one company's traffic. */
const REPLY_SAMPLE_LIMIT = 5000;

/**
 * How long a customer waits for an answer — measured, not estimated.
 *
 * For each conversation that received a customer message in the window, this
 * pairs that first inbound message with the first outbound message that
 * followed it. The gap is what the customer actually experienced, so an
 * automation's reply counts exactly as much as a person's (and the card says
 * so). Conversations nobody has answered yet contribute no gap — they are
 * reported separately rather than quietly dragging the average down or, worse,
 * being counted as instant.
 */
export async function ReplySpeedSection({ companyId }: { companyId: string }) {
  const db = getDb();
  const { since } = reportWindow();

  const rows = await db
    .select({
      conversationId: message.conversationId,
      direction: message.direction,
      createdAt: message.createdAt,
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(and(eq(contact.companyId, companyId), gte(message.createdAt, since)))
    .orderBy(asc(message.createdAt))
    .limit(REPLY_SAMPLE_LIMIT);

  const firstInboundAt = new Map<string, number>();
  const answered = new Set<string>();
  const waits: number[] = [];

  for (const r of rows) {
    const at = new Date(r.createdAt).getTime();
    if (r.direction === "IN") {
      if (!firstInboundAt.has(r.conversationId)) firstInboundAt.set(r.conversationId, at);
      continue;
    }
    const asked = firstInboundAt.get(r.conversationId);
    if (asked == null || answered.has(r.conversationId)) continue;
    answered.add(r.conversationId);
    waits.push((at - asked) / 1000);
  }

  const measured = waits.length;
  const stillWaiting = firstInboundAt.size - measured;
  const average = measured ? waits.reduce((a, b) => a + b, 0) / measured : 0;
  const longest = measured ? Math.max(...waits) : 0;

  return (
    <Card title="How fast customers get an answer" meta={<Pill kind="real" />}>
      {measured === 0 ? (
        <NoData>
          Nobody has written in over the last seven days, so there is no waiting
          time to measure.
        </NoData>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Average wait" value={humanDuration(average)} />
            <Stat label="Longest wait" value={humanDuration(longest)} />
            <Stat label="Chats measured" value={measured} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
            Last 7 days, Malaysian time. Measured from the customer&apos;s first
            message to the first reply they received, whether that reply came
            from the team or from an automation.
            {stillWaiting > 0 &&
              ` ${stillWaiting} ${stillWaiting === 1 ? "chat is" : "chats are"} still waiting for a first reply.`}
          </p>
        </>
      )}
    </Card>
  );
}

export function ReplySpeedSkeleton() {
  return (
    <Card title="How fast customers get an answer" meta={<Pill kind="real" />}>
      <div className="skeleton-stagger grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--color-border)] p-4"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[12px] w-20" />
            <Skel className="mt-2 h-[24px] w-16" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <Skel className="h-[11px] w-full" />
        <Skel className="h-[11px] w-2/3" />
      </div>
    </Card>
  );
}

// ─────────────────────── Marketing · tag reach ───────────────────────

export async function TagReachSection({ companyId }: { companyId: string }) {
  const db = getDb();
  // Reach is a count, so count it in Postgres. Loading every contact↔tag link
  // row into the Worker just to read `.length` is what this replaces.
  const rows = await db
    .select({
      name: tag.name,
      color: tag.color,
      reach: count(contactTag.contactId),
    })
    .from(tag)
    .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
    .where(eq(tag.companyId, companyId))
    .groupBy(tag.id, tag.name, tag.color)
    .orderBy(desc(count(contactTag.contactId)))
    .limit(6);

  return (
    <Card title="Contacts per tag" meta={<Pill kind="real" />}>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">
          No tags yet — add them under Settings.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((t) => (
            <BarRow
              key={t.name}
              label={t.name}
              value={String(t.reach)}
              pct={pctOf(t.reach, maxReach(rows))}
              color={t.color}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export function TagReachSkeleton() {
  return (
    <Card title="Contacts per tag" meta={<Pill kind="real" />}>
      <div className="skeleton-stagger flex flex-col gap-3">
        {[92, 74, 58, 44, 30, 20].map((pct, i) => (
          <div
            key={pct}
            className="flex items-center gap-3"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[13px] w-28 shrink-0" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div className="skeleton h-full rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <Skel className="h-[13px] w-8 shrink-0" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────── Live reporting · activity feed ───────────────────────

/**
 * The two feeds that can be attributed to a company: messages (through their
 * conversation's contact) and automation runs (through the automation).
 *
 * Inbound webhook deliveries used to be merged in here too. They are not: the
 * `webhook_event` table has no company_id, so on a shared deployment this card
 * was showing another company's traffic to whoever opened the dashboard. They
 * still have a page of their own under System Logs → Webhooks.
 */
export async function ActivitySection({ companyId }: { companyId: string }) {
  const db = getDb();
  const [msgs, runs] = await Promise.all([
    db
      .select({
        id: message.id,
        body: message.body,
        direction: message.direction,
        createdAt: message.createdAt,
      })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(eq(contact.companyId, companyId))
      .orderBy(desc(message.createdAt))
      .limit(10),
    db
      .select({
        id: automationRun.id,
        status: automationRun.status,
        name: automation.name,
        createdAt: automationRun.createdAt,
      })
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(eq(automation.companyId, companyId))
      .orderBy(desc(automationRun.createdAt))
      .limit(8),
  ]);

  const items = [
    ...msgs.map((m) => ({
      id: `m-${m.id}`,
      kind: m.direction === "OUT" ? "Sent" : "Received",
      text: (m.body ?? "(no text)").slice(0, 80),
      ts: new Date(m.createdAt).getTime(),
    })),
    ...runs.map((r) => ({
      id: `r-${r.id}`,
      kind: "Automation",
      text: `${r.name} · ${RUN_STATUS[r.status] ?? r.status}`,
      ts: new Date(r.createdAt).getTime(),
    })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12)
    .map((a) => ({ id: a.id, kind: a.kind, text: a.text, at: relTime(new Date(a.ts)) }));

  return (
    <Card title="Latest activity" meta={<Pill kind="real" />}>
      {items.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">
          Nothing has happened yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 text-[13px] last:border-0"
            >
              <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                {a.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                {a.text}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                {a.at}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** automation_run.status is free-form text written by the engine. */
const RUN_STATUS: Record<string, string> = {
  running: "still running",
  waiting: "waiting for the customer",
  completed: "finished",
  failed: "failed",
};

export function ActivitySkeleton() {
  return (
    <Card title="Latest activity" meta={<Pill kind="real" />}>
      <ul className="skeleton-stagger flex flex-col">
        {Array.from({ length: 8 }, (_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[11px] w-20 shrink-0" />
            <Skel className="h-[14px] min-w-0 flex-1" />
            <Skel className="h-[11px] w-12 shrink-0" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────── Message analytics · 7-day series ───────────────────────

export async function MessagesSeriesSection({ companyId }: { companyId: string }) {
  const db = getDb();
  const { since, days } = reportWindow();

  // Bucket in Postgres: seven rows back instead of every outbound message of
  // the week. Only OUT rows are charted, so only OUT rows are read.
  //
  // The buckets are Malaysian days. `created_at` is a timestamptz and the Worker
  // runs on UTC, so without the conversion a day on this chart ran 08:00→08:00
  // and the owner's morning sends landed in yesterday's column.
  const dayExpr = sql<string>`to_char(date_trunc('day', ${message.createdAt} at time zone 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day: dayExpr,
      sent: count(),
      read: sql<number>`count(*) filter (where ${message.status} = 'READ')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${message.status} = 'FAILED')`.mapWith(
        Number
      ),
    })
    .from(message)
    .innerJoin(conversation, eq(conversation.id, message.conversationId))
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(
      and(
        eq(contact.companyId, companyId),
        eq(message.direction, "OUT"),
        gte(message.createdAt, since)
      )
    )
    .groupBy(dayExpr);

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = days.map((d) => byDay.get(d.key));

  return (
    <Card title="Messages sent (last 7 days)" meta={<Pill kind="real" />}>
      <LineChart
        labels={days.map((d) => d.label)}
        series={[
          {
            name: "Sent",
            color: "var(--color-accent)",
            points: series.map((r) => r?.sent ?? 0),
          },
          {
            name: "Read",
            color: "var(--color-brand)",
            points: series.map((r) => r?.read ?? 0),
          },
          {
            name: "Failed",
            color: "var(--color-danger)",
            points: series.map((r) => r?.failed ?? 0),
          },
        ]}
      />
      <Legend
        items={[
          { name: "Sent", color: "var(--color-accent)" },
          { name: "Read", color: "var(--color-brand)" },
          { name: "Failed", color: "var(--color-danger)" },
        ]}
      />
    </Card>
  );
}

/** Matches the chart's fixed 132px plot box plus the legend row beneath it. */
export function MessagesSeriesSkeleton() {
  return (
    <Card title="Messages sent (last 7 days)" meta={<Pill kind="real" />}>
      <div className="skeleton-stagger flex h-[132px] items-end gap-2 px-1 pb-[18px]">
        {[46, 68, 54, 82, 61, 39, 72].map((h, i) => (
          <div
            key={h}
            className="skeleton flex-1 rounded-t"
            style={{ height: `${h}%`, "--i": i } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {["Sent", "Read", "Failed"].map((n) => (
          <Skel key={n} className="h-[13px] w-12" />
        ))}
      </div>
    </Card>
  );
}

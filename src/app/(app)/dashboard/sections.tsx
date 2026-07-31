import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automationRun,
  contactTag,
  conversation,
  member,
  message,
  tag,
  webhookEvent,
} from "@/db/schema";
import { relTime } from "@/lib/format";
import { Skel } from "@/components/skeleton";
import { LineChart } from "./charts";
import { BarRow, Card, Legend, Pill } from "./ui";
import { maxReach, pctOf, reportWindow } from "./util";

/*
  Streamed dashboard sections.

  The page's cheap counters (a couple of aggregate round-trips) resolve before
  the first byte, so the shell, the tab strip and every KPI tile paint straight
  away. The four sections below are the ones that actually scan rows — a
  grouped per-agent aggregate, tag reach across the contact↔tag join, the merged
  activity feed, and the seven-day message series — so each one gets its own
  `<Suspense>` boundary and streams in behind a skeleton the same size as the
  card it replaces.

  Each section owns its query. They are siblings under separate boundaries, so
  they still run concurrently — this is a fan-out, not a waterfall.
*/

// ─────────────────────── Support · per-agent load ───────────────────────

export async function AgentLoadSection({
  unassignedOpen,
}: {
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
      .where(isNotNull(conversation.assignedAgentId))
      .groupBy(conversation.assignedAgentId),
    db.select({ id: member.id, name: member.name }).from(member),
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
    <Card title="Assigned agents" meta={<Pill kind="real" />}>
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
              <span className="text-[var(--color-faint)]">Unassigned</span>
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
    <Card title="Assigned agents" meta={<Pill kind="real" />}>
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
    <Card title="Tag reach" meta={<Pill kind="real" />}>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">No tags yet.</p>
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
    <Card title="Tag reach" meta={<Pill kind="real" />}>
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

export async function ActivitySection() {
  const db = getDb();
  const [msgs, runs, hooks] = await Promise.all([
    db
      .select({
        id: message.id,
        body: message.body,
        direction: message.direction,
        createdAt: message.createdAt,
      })
      .from(message)
      .orderBy(desc(message.createdAt))
      .limit(8),
    db
      .select({
        id: automationRun.id,
        status: automationRun.status,
        createdAt: automationRun.createdAt,
      })
      .from(automationRun)
      .orderBy(desc(automationRun.createdAt))
      .limit(6),
    db
      .select({
        id: webhookEvent.id,
        source: webhookEvent.source,
        eventType: webhookEvent.eventType,
        createdAt: webhookEvent.createdAt,
      })
      .from(webhookEvent)
      .orderBy(desc(webhookEvent.createdAt))
      .limit(6),
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
      text: `Automation run · ${r.status}`,
      ts: new Date(r.createdAt).getTime(),
    })),
    ...hooks.map((w) => ({
      id: `w-${w.id}`,
      kind: "Webhook",
      text: `${w.source}${w.eventType ? ` · ${w.eventType}` : ""}`,
      ts: new Date(w.createdAt).getTime(),
    })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12)
    .map((a) => ({ id: a.id, kind: a.kind, text: a.text, at: relTime(new Date(a.ts)) }));

  return (
    <Card title="Recent activity" meta={<Pill kind="real" />}>
      {items.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">No recent activity.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 text-[13px] last:border-0"
            >
              <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
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

export function ActivitySkeleton() {
  return (
    <Card title="Recent activity" meta={<Pill kind="real" />}>
      <ul className="skeleton-stagger flex flex-col">
        {Array.from({ length: 8 }, (_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[11px] w-16 shrink-0" />
            <Skel className="h-[14px] min-w-0 flex-1" />
            <Skel className="h-[11px] w-12 shrink-0" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────── Message analytics · 7-day series ───────────────────────

export async function MessagesSeriesSection() {
  const db = getDb();
  const { since, days } = reportWindow();

  // Bucket in Postgres: seven rows back instead of every outbound message of
  // the week. Only OUT rows are charted, so only OUT rows are read.
  const dayExpr = sql<string>`to_char(date_trunc('day', ${message.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
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
    .where(and(eq(message.direction, "OUT"), gte(message.createdAt, since)))
    .groupBy(dayExpr);

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = days.map((d) => byDay.get(d.key));

  return (
    <Card title="Messages over time (7 days)" meta={<Pill kind="real" />}>
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
    <Card title="Messages over time (7 days)" meta={<Pill kind="real" />}>
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

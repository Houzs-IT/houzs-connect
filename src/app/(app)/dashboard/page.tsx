import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  automationRun,
  campaign,
  contact,
  conversation,
  member,
  message,
  webhookEvent,
} from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime } from "@/lib/format";
import { DashboardTabs, type DashboardData } from "./DashboardTabs";

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Compute the reporting window outside the component body: reading the clock
// (Date.now) is impure, and the react purity lint rightly forbids that directly
// in a render. A single call here fixes "now" for the whole request.
function reportWindow(): { since: Date; today: Date } {
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return { since: new Date(now - 7 * 24 * 3600 * 1000), today };
}

/**
 * Dashboard — Seampify-parity tabbed analytics. Every real count comes from the
 * `connect` schema; figures Connect does not yet capture (spend, response times,
 * calling) are computed as demo/derived values and clearly labelled in the UI.
 * The server does all fetching (batched in one Promise.all so the request stays a
 * single pipelined round-trip) and hands a serialisable object to the client tabs.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const db = getDb();
  const { tab } = await searchParams;
  const { since, today } = reportWindow();

  const [
    contacts,
    conversations,
    openConvos,
    closedConvos,
    pendingConvos,
    queueConvos,
    automations,
    campaignsTotal,
    members,
    outbound,
    inbound,
    deliveredTotal,
    readTotal,
    failedTotal,
    optIn,
    campaignsCompleted,
    templateUsage,
    unassignedOpen,
    agentRows,
    membersList,
    tagsWithLinks,
    recentMsgs,
    activityMsgs,
    activityRuns,
    activityHooks,
  ] = await Promise.all([
    db.$count(contact),
    db.$count(conversation),
    db.$count(conversation, eq(conversation.status, "OPEN")),
    db.$count(conversation, eq(conversation.status, "CLOSED")),
    db.$count(conversation, eq(conversation.status, "PENDING")),
    db.$count(conversation, eq(conversation.status, "QUEUE")),
    db.$count(automation, eq(automation.enabled, true)),
    db.$count(campaign),
    db.$count(member),
    db.$count(message, eq(message.direction, "OUT")),
    db.$count(message, eq(message.direction, "IN")),
    db.$count(message, and(eq(message.direction, "OUT"), eq(message.status, "DELIVERED"))),
    db.$count(message, and(eq(message.direction, "OUT"), eq(message.status, "READ"))),
    db.$count(message, and(eq(message.direction, "OUT"), eq(message.status, "FAILED"))),
    db.$count(contact, eq(contact.marketingOptIn, true)),
    db.$count(campaign, eq(campaign.status, "completed")),
    db.$count(message, eq(message.type, "TEMPLATE")),
    db.$count(conversation, and(eq(conversation.status, "OPEN"), isNull(conversation.assignedAgentId))),
    // Per-agent conversation load (open + total) — Postgres filtered aggregate.
    db
      .select({
        agentId: conversation.assignedAgentId,
        total: count(),
        open: sql<number>`count(*) filter (where ${conversation.status} = 'OPEN')`.mapWith(Number),
      })
      .from(conversation)
      .where(isNotNull(conversation.assignedAgentId))
      .groupBy(conversation.assignedAgentId),
    db.select({ id: member.id, name: member.name }).from(member),
    db.query.tag.findMany({ with: { contactLinks: true } }),
    db
      .select({
        createdAt: message.createdAt,
        direction: message.direction,
        status: message.status,
      })
      .from(message)
      .where(gte(message.createdAt, since)),
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

  // ─── Spend (demo — mirrors Seampify conversation-billing dashboard) ───
  const spend = [
    { label: "Marketing", value: "MYR 0.00", pct: 3 },
    { label: "Utility", value: "MYR 19.97", pct: 82 },
    { label: "Service", value: "MYR 0.00", pct: 3 },
    { label: "Marketing-Lite", value: "MYR 3.47", pct: 18 },
  ];

  // ─── Support: map grouped agent rows onto member names ───
  const nameById = new Map(membersList.map((m) => [m.id, m.name]));
  const agents = agentRows
    .map((r) => ({
      name: (r.agentId && nameById.get(r.agentId)) || "Unknown agent",
      open: r.open,
      total: r.total,
    }))
    .sort((a, b) => b.open - a.open || b.total - a.total)
    .slice(0, 8);

  // ─── Marketing: tag reach ───
  const tags = tagsWithLinks
    .map((t) => ({ name: t.name, color: t.color, reach: t.contactLinks.length }))
    .sort((a, b) => b.reach - a.reach)
    .slice(0, 6);

  // ─── Message analytics: bucket the last 7 days by outbound status ───
  const days: { key: string; label: string; sent: number; read: number; failed: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      key: dayKey(d),
      label: d.toLocaleDateString("en-GB", { weekday: "short" }),
      sent: 0,
      read: 0,
      failed: 0,
    });
  }
  const dayIdx = new Map(days.map((d, i) => [d.key, i]));
  for (const m of recentMsgs) {
    const d = new Date(m.createdAt);
    d.setHours(0, 0, 0, 0);
    const i = dayIdx.get(dayKey(d));
    if (i == null || m.direction !== "OUT") continue;
    days[i].sent++;
    if (m.status === "READ") days[i].read++;
    if (m.status === "FAILED") days[i].failed++;
  }

  // ─── Live reporting: merge recent messages / runs / webhooks ───
  const activityItems = [
    ...activityMsgs.map((m) => ({
      id: `m-${m.id}`,
      kind: m.direction === "OUT" ? "Sent" : "Received",
      text: (m.body ?? "(no text)").slice(0, 80),
      ts: new Date(m.createdAt).getTime(),
    })),
    ...activityRuns.map((r) => ({
      id: `r-${r.id}`,
      kind: "Automation",
      text: `Automation run · ${r.status}`,
      ts: new Date(r.createdAt).getTime(),
    })),
    ...activityHooks.map((w) => ({
      id: `w-${w.id}`,
      kind: "Webhook",
      text: `${w.source}${w.eventType ? ` · ${w.eventType}` : ""}`,
      ts: new Date(w.createdAt).getTime(),
    })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 12)
    .map((a) => ({ id: a.id, kind: a.kind, text: a.text, at: relTime(new Date(a.ts)) }));

  const data: DashboardData = {
    kpis: {
      contacts,
      conversations,
      openConvos,
      closedConvos,
      pendingConvos,
      queueConvos,
      automations,
      campaigns: campaignsTotal,
      members,
      outbound,
      inbound,
    },
    spend,
    support: { agents, unassignedOpen },
    marketing: {
      campaignsCompleted,
      funnel: {
        sent: outbound,
        delivered: deliveredTotal + readTotal, // read implies delivered
        read: readTotal,
        replied: inbound,
      },
      optIn,
      tags,
    },
    activity: activityItems,
    messages: {
      labels: days.map((d) => d.label),
      sent: days.map((d) => d.sent),
      read: days.map((d) => d.read),
      failed: days.map((d) => d.failed),
      statusTotals: {
        sent: outbound,
        delivered: deliveredTotal,
        read: readTotal,
        failed: failedTotal,
      },
      templateUsage,
    },
  };

  return (
    <PageChrome
      title="Dashboard"
      subtitle="Spend, delivery, support & message analytics"
    >
      <DashboardTabs data={data} initialTab={tab} />
    </PageChrome>
  );
}

import { Suspense } from "react";
import { count, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  campaign,
  contact,
  conversation,
  member,
  message,
} from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { DashboardTabs, type DashboardKpis } from "./DashboardTabs";
import {
  ActivitySection,
  ActivitySkeleton,
  AgentLoadSection,
  AgentLoadSkeleton,
  MessagesSeriesSection,
  MessagesSeriesSkeleton,
  TagReachSection,
  TagReachSkeleton,
} from "./sections";

/**
 * Dashboard — Seampify-parity tabbed analytics. Every real count comes from the
 * `connect` schema; figures Connect does not yet capture (spend, response times,
 * calling) are computed as demo/derived values and clearly labelled in the UI.
 *
 * Two-phase render:
 *
 *  · Phase 1 (blocks TTFB) — the counters. Six batched round-trips instead of
 *    the eighteen this used to issue: the conversation, message, contact and
 *    campaign figures are each one grouped aggregate now
 *    (`count(*) filter (where …)`), a single scan per table rather than one per
 *    status. Every result is O(1) rows, so the shell, the tab strip and every
 *    KPI tile land in the first flush.
 *
 *  · Phase 2 (streams) — the four cards that actually read rows, each behind its
 *    own <Suspense> and its own skeleton. They are siblings, so they still fan
 *    out in parallel; nothing here reintroduces a waterfall.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const db = getDb();
  const [{ tab }, me] = await Promise.all([searchParams, getCurrentMember()]);
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login

  const [convoAgg, msgAgg, contactAgg, campaignAgg, automations, members] =
    await Promise.all([
      // One pass over `conversation` for every status figure.
      db
        .select({
          total: count(),
          open: sql<number>`count(*) filter (where ${conversation.status} = 'OPEN')`.mapWith(
            Number
          ),
          closed:
            sql<number>`count(*) filter (where ${conversation.status} = 'CLOSED')`.mapWith(
              Number
            ),
          pending:
            sql<number>`count(*) filter (where ${conversation.status} = 'PENDING')`.mapWith(
              Number
            ),
          queue:
            sql<number>`count(*) filter (where ${conversation.status} = 'QUEUE')`.mapWith(
              Number
            ),
          unassignedOpen:
            sql<number>`count(*) filter (where ${conversation.status} = 'OPEN' and ${conversation.assignedAgentId} is null)`.mapWith(
              Number
            ),
        })
        .from(conversation),
      // One pass over `message` for direction, delivery status and template use.
      db
        .select({
          outbound:
            sql<number>`count(*) filter (where ${message.direction} = 'OUT')`.mapWith(
              Number
            ),
          inbound:
            sql<number>`count(*) filter (where ${message.direction} = 'IN')`.mapWith(
              Number
            ),
          delivered:
            sql<number>`count(*) filter (where ${message.direction} = 'OUT' and ${message.status} = 'DELIVERED')`.mapWith(
              Number
            ),
          read: sql<number>`count(*) filter (where ${message.direction} = 'OUT' and ${message.status} = 'READ')`.mapWith(
            Number
          ),
          failed:
            sql<number>`count(*) filter (where ${message.direction} = 'OUT' and ${message.status} = 'FAILED')`.mapWith(
              Number
            ),
          template:
            sql<number>`count(*) filter (where ${message.type} = 'TEMPLATE')`.mapWith(
              Number
            ),
        })
        .from(message),
      db
        .select({
          total: count(),
          optIn: sql<number>`count(*) filter (where ${contact.marketingOptIn})`.mapWith(
            Number
          ),
        })
        .from(contact),
      db
        .select({
          total: count(),
          completed:
            sql<number>`count(*) filter (where ${campaign.status} = 'completed')`.mapWith(
              Number
            ),
        })
        .from(campaign),
      db.$count(automation, eq(automation.enabled, true)),
      db.$count(member),
    ]);

  const c = convoAgg[0];
  const m = msgAgg[0];
  const ct = contactAgg[0];
  const cp = campaignAgg[0];

  const kpis: DashboardKpis = {
    contacts: ct.total,
    conversations: c.total,
    openConvos: c.open,
    closedConvos: c.closed,
    pendingConvos: c.pending,
    queueConvos: c.queue,
    automations,
    campaigns: cp.total,
    campaignsCompleted: cp.completed,
    members,
    outbound: m.outbound,
    inbound: m.inbound,
    delivered: m.delivered,
    read: m.read,
    failed: m.failed,
    optIn: ct.optIn,
    templateUsage: m.template,
  };

  // Spend (demo — mirrors the Seampify conversation-billing dashboard).
  const spend = [
    { label: "Marketing", value: "MYR 0.00", pct: 3 },
    { label: "Utility", value: "MYR 19.97", pct: 82 },
    { label: "Service", value: "MYR 0.00", pct: 3 },
    { label: "Marketing-Lite", value: "MYR 3.47", pct: 18 },
  ];

  return (
    <PageChrome
      title="Dashboard"
      subtitle="Spend, delivery, support & message analytics"
    >
      <DashboardTabs
        kpis={kpis}
        spend={spend}
        initialTab={tab}
        slots={{
          agentLoad: (
            <Suspense fallback={<AgentLoadSkeleton />}>
              <AgentLoadSection unassignedOpen={c.unassignedOpen} />
            </Suspense>
          ),
          tagReach: (
            <Suspense fallback={<TagReachSkeleton />}>
              <TagReachSection companyId={me.companyId} />
            </Suspense>
          ),
          activity: (
            <Suspense fallback={<ActivitySkeleton />}>
              <ActivitySection />
            </Suspense>
          ),
          messagesSeries: (
            <Suspense fallback={<MessagesSeriesSkeleton />}>
              <MessagesSeriesSection />
            </Suspense>
          ),
        }}
      />
    </PageChrome>
  );
}

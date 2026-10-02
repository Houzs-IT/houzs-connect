import { Suspense } from "react";
import { and, count, eq, gte, sql } from "drizzle-orm";
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
  ReplySpeedSection,
  ReplySpeedSkeleton,
  TagReachSection,
  TagReachSkeleton,
} from "./sections";
import { reportWindow } from "./util";

/**
 * Dashboard — every figure on this page is read from the `connect` schema for
 * the signed-in member's company. Nothing is sampled, seeded or illustrative:
 * where Connect has no source for a metric (Meta's conversation billing, and
 * WhatsApp calling) the card says so in words rather than showing a number.
 *
 * Company scoping: `contact`, `campaign`, `automation`, `member` and `tag` all
 * carry `company_id`. `conversation` and `message` do not, so they are scoped
 * through the join every other page uses — conversation → contact → company.
 *
 * Two-phase render:
 *
 *  · Phase 1 (blocks TTFB) — the counters. Six batched round-trips: the
 *    conversation, message, contact and campaign figures are each one grouped
 *    aggregate (`count(*) filter (where …)`), a single scan per table rather
 *    than one per status. Every result is O(1) rows, so the shell, the tab strip
 *    and every KPI tile land in the first flush.
 *
 *  · Phase 2 (streams) — the five cards that actually read rows, each behind its
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

  const companyId = me.companyId;
  // Same seven Malaysian days the message chart buckets by, so the headline
  // "last 7 days" figure and the chart can never disagree.
  const { since } = reportWindow();
  const mine = eq(contact.companyId, companyId);

  const [convoAgg, msgAgg, contactAgg, campaignAgg, automations, members] =
    await Promise.all([
      // One pass over this company's `conversation` rows for every status figure.
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
        .from(conversation)
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(mine),
      // One pass over this company's `message` rows for direction, delivery
      // status, template use and the seven-day send count.
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
          // `gte(...)` rather than a hand-written comparison so the Date is
          // encoded by the column's own mapper — the same path the seven-day
          // chart already uses.
          sent7:
            sql<number>`count(*) filter (where ${message.direction} = 'OUT' and ${gte(
              message.createdAt,
              since
            )})`.mapWith(Number),
        })
        .from(message)
        .innerJoin(conversation, eq(conversation.id, message.conversationId))
        .innerJoin(contact, eq(contact.id, conversation.contactId))
        .where(mine),
      db
        .select({
          total: count(),
          optIn: sql<number>`count(*) filter (where ${contact.marketingOptIn})`.mapWith(
            Number
          ),
        })
        .from(contact)
        .where(mine),
      db
        .select({
          total: count(),
          completed:
            sql<number>`count(*) filter (where ${campaign.status} = 'completed')`.mapWith(
              Number
            ),
        })
        .from(campaign)
        .where(eq(campaign.companyId, companyId)),
      db.$count(
        automation,
        and(eq(automation.companyId, companyId), eq(automation.enabled, true))
      ),
      // Members who have left are kept as rows (they own past assignments) and
      // marked inactive — counting them would overstate the team.
      db.$count(
        member,
        and(eq(member.companyId, companyId), eq(member.active, true))
      ),
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
    sentLast7Days: m.sent7,
  };

  return (
    <PageChrome section="dashboard" page="overview">
      <DashboardTabs
        kpis={kpis}
        initialTab={tab}
        slots={{
          replySpeed: (
            <Suspense fallback={<ReplySpeedSkeleton />}>
              <ReplySpeedSection companyId={companyId} />
            </Suspense>
          ),
          agentLoad: (
            <Suspense fallback={<AgentLoadSkeleton />}>
              <AgentLoadSection
                companyId={companyId}
                unassignedOpen={c.unassignedOpen}
              />
            </Suspense>
          ),
          tagReach: (
            <Suspense fallback={<TagReachSkeleton />}>
              <TagReachSection companyId={companyId} />
            </Suspense>
          ),
          activity: (
            <Suspense fallback={<ActivitySkeleton />}>
              <ActivitySection companyId={companyId} />
            </Suspense>
          ),
          messagesSeries: (
            <Suspense fallback={<MessagesSeriesSkeleton />}>
              <MessagesSeriesSection companyId={companyId} />
            </Suspense>
          ),
        }}
      />
    </PageChrome>
  );
}

// The time-based executor. Everything here is called from the cron tick
// (src/app/api/cron/route.ts), which a Cloudflare Cron Trigger pings every couple
// of minutes. Before this existed there was no scheduler at all, so a Delay node
// paused forever and a scheduled campaign only sent when a human clicked.
//
// Each sweep is bounded per tick (a Worker has a CPU/subrequest budget) and
// claims each item atomically (a conditional UPDATE) so two overlapping ticks
// can never double-fire the same run or campaign.

import { and, eq, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automationRun, campaign as campaignTable } from "@/db/schema";
import { ensureAutomationRunColumns } from "@/db/ensure-automation-run";
import { resumeDelayRun } from "./engine";
import { leaseFree, sendCampaignChunk, type Db } from "@/app/(app)/campaigns/send";

/** Delayed runs resumed per tick. One `advance()` each; the 2-min cron catches
 *  the rest. */
const DELAY_BATCH = 100;

/** Scheduled campaigns started per tick, and the chunk-loop safety belt per
 *  campaign (each chunk is SEND_CHUNK recipients). */
const CAMPAIGN_LIMIT = 10;
const CAMPAIGN_MAX_CHUNKS = 500;
/** A campaign left "sending" (tab closed, a tick's chunk cap, a killed Worker)
 *  is resumed by the cron only while it is this fresh — counted from
 *  stats.startedAt. Older ones wait for a person to press Resume on the
 *  Campaigns page, so a campaign that stalled long ago (including any stuck
 *  before the 2026-11-28 fix) never wakes up by itself and reaches customers
 *  days late. */
export const RESUME_WITHIN_HOURS = 6;

/**
 * Wake automation runs that paused on a Delay node whose time is up. Claims each
 * (waiting → running, clearing resume_at) before resuming, so a concurrent tick
 * that already claimed it is skipped rather than running it twice.
 */
export async function resumeDueDelays(): Promise<{ resumed: number }> {
  const db = getDb();
  // The column may predate the live DB on a fresh deploy (see the file's note).
  await ensureAutomationRunColumns(db).catch(() => {});
  const now = new Date();
  const due = await db
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(
      and(
        eq(automationRun.status, "waiting"),
        isNotNull(automationRun.resumeAt),
        lte(automationRun.resumeAt, now)
      )
    )
    .limit(DELAY_BATCH);

  let resumed = 0;
  for (const { id } of due) {
    const [claimed] = await db
      .update(automationRun)
      .set({ status: "running", resumeAt: null })
      .where(and(eq(automationRun.id, id), eq(automationRun.status, "waiting")))
      .returning({ id: automationRun.id });
    if (!claimed) continue; // another tick took it first
    try {
      if (await resumeDelayRun(id)) resumed++;
    } catch {
      // A single bad run must not stop the sweep; the engine logs its own errors.
    }
  }
  return { resumed };
}

/** The campaigns a tick should send: due scheduled ones, and recent ones left "sending" with a free lease. */
export async function campaignsToSend(db: Db, now: Date): Promise<{ id: string; companyId: string }[]> {
  const approved = or(eq(campaignTable.requiresApproval, false), isNotNull(campaignTable.approvedByMemberId));
  return db
    .select({ id: campaignTable.id, companyId: campaignTable.companyId })
    .from(campaignTable)
    .where(
      or(
        and(eq(campaignTable.status, "scheduled"), isNotNull(campaignTable.scheduleAt), lte(campaignTable.scheduleAt, now), approved),
        // Audit 2026-11-28 (X3): a campaign that stopped halfway used to stay
        // "sending" forever — the cron only looked at "scheduled". Resume it
        // when nobody holds its lease (send.ts) and it started recently.
        and(
          eq(campaignTable.status, "sending"),
          approved,
          leaseFree,
          sql`(${campaignTable.stats} ->> 'startedAt')::timestamptz > now() - make_interval(hours => ${RESUME_WITHIN_HOURS})`
        )
      )
    )
    .limit(CAMPAIGN_LIMIT);
}

/**
 * Send SCHEDULED campaigns whose time has arrived (and that are approved, or need
 * no approval), and resume recent ones left "sending". The claim + lease live
 * inside sendCampaignChunk, so this never races a manual "Send now" (the loser
 * gets `busy` and stops); each campaign is driven to completion here, bounded
 * by the chunk cap to protect the tick's budget. A campaign too large for one
 * tick stays "sending" and the next tick carries on.
 */
export async function sendDueScheduledCampaigns(): Promise<{ campaigns: number; sent: number }> {
  const db = getDb();
  const now = new Date();
  const due = await campaignsToSend(db, now);

  let campaigns = 0;
  let sent = 0;
  for (const c of due) {
    let started = false;
    let lastSent = 0;
    for (let i = 0; i < CAMPAIGN_MAX_CHUNKS; i++) {
      const res = await sendCampaignChunk(db, c.companyId, c.id);
      if (!res.ok) break; // not approved / nobody to message / already claimed
      started = true;
      lastSent = res.sent ?? 0; // cumulative across chunks; take the last, don't sum
      if (!res.remaining || res.remaining <= 0) break;
    }
    if (started) {
      campaigns++;
      sent += lastSent;
    }
  }
  return { campaigns, sent };
}

// The time-based executor. Everything here is called from the cron tick
// (src/app/api/cron/route.ts), which a Cloudflare Cron Trigger pings every couple
// of minutes. Before this existed there was no scheduler at all, so a Delay node
// paused forever and a scheduled campaign only sent when a human clicked.
//
// Each sweep is bounded per tick (a Worker has a CPU/subrequest budget) and
// claims each item atomically (a conditional UPDATE) so two overlapping ticks
// can never double-fire the same run or campaign.

import { and, eq, isNotNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automationRun, campaign as campaignTable } from "@/db/schema";
import { ensureAutomationRunColumns } from "@/db/ensure-automation-run";
import { resumeDelayRun } from "./engine";
import { sendCampaignChunk } from "@/app/(app)/campaigns/send";

/** Delayed runs resumed per tick. One `advance()` each; the 2-min cron catches
 *  the rest. */
const DELAY_BATCH = 100;

/** Scheduled campaigns started per tick, and the chunk-loop safety belt per
 *  campaign (each chunk is SEND_CHUNK recipients). */
const CAMPAIGN_LIMIT = 10;
const CAMPAIGN_MAX_CHUNKS = 500;

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

/**
 * Send SCHEDULED campaigns whose time has arrived (and that are approved, or need
 * no approval). The atomic draft/scheduled→sending claim lives inside
 * sendCampaignChunk, so this never races a manual "Send now"; each due campaign
 * is driven to completion here, bounded by the chunk cap to protect the tick's
 * budget. A campaign too large for one tick is left "sending" for an operator to
 * finish — the same ceiling the manual loop already lives with.
 */
export async function sendDueScheduledCampaigns(): Promise<{ campaigns: number; sent: number }> {
  const db = getDb();
  const now = new Date();
  const due = await db
    .select({ id: campaignTable.id, companyId: campaignTable.companyId })
    .from(campaignTable)
    .where(
      and(
        eq(campaignTable.status, "scheduled"),
        isNotNull(campaignTable.scheduleAt),
        lte(campaignTable.scheduleAt, now),
        or(
          eq(campaignTable.requiresApproval, false),
          isNotNull(campaignTable.approvedByMemberId)
        )
      )
    )
    .limit(CAMPAIGN_LIMIT);

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

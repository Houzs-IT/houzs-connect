import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { resumeDueDelays, sendDueScheduledCampaigns } from "@/lib/automation/sweeper";

/**
 * POST /api/cron — the scheduler tick.
 *
 * A Cloudflare Cron Trigger fires worker.ts's scheduled() handler every couple of
 * minutes, which self-fetches this route (so the work runs in a normal request
 * context where getDb() and secrets behave exactly as in any request — a
 * scheduled() handler cannot call getDb() directly). It runs the time-based
 * sweeps: resume Delay runs that are due, and send scheduled campaigns that are
 * due. Each sweep is isolated so one failing does not block the others, and a
 * summary is written to System Logs (webhook_event, source "cron").
 *
 * Guard: header `x-cron-key` must equal env.CRON_SECRET. Unset => 503 (fail
 * closed), so a missing secret can never leave the tick open to the internet.
 */
export async function POST(req: NextRequest) {
  const { env } = getCloudflareContext();
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }
  if (req.headers.get("x-cron-key") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Each sweep stands alone: a failure in one is recorded and the others still run.
  const summary: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  try {
    summary.delays = await resumeDueDelays();
  } catch (e) {
    errors.delays = e instanceof Error ? e.message : String(e);
  }
  try {
    summary.campaigns = await sendDueScheduledCampaigns();
  } catch (e) {
    errors.campaigns = e instanceof Error ? e.message : String(e);
  }

  const hadError = Object.keys(errors).length > 0;
  // One System Logs row per tick that actually did something or failed — a tick
  // that resumed nothing and sent nothing writes nothing, so the log stays readable.
  const didWork =
    (summary.delays as { resumed?: number })?.resumed ||
    (summary.campaigns as { campaigns?: number })?.campaigns ||
    hadError;
  if (didWork) {
    try {
      await getDb()
        .insert(webhookEvent)
        .values({
          source: "cron",
          eventType: hadError ? "cron:tick:error" : "cron:tick:ok",
          payload: { ...summary, ...(hadError ? { errors } : {}) },
          processed: true,
        });
    } catch {
      // Logging must never fail the tick.
    }
  }

  return NextResponse.json({ ok: !hadError, ...summary, ...(hadError ? { errors } : {}) });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "cron",
    hint: "POST with x-cron-key; driven by the Cloudflare Cron Trigger via worker.ts",
  });
}

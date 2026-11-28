// The session-free heart of campaign sending.
//
// `sendCampaignNow` (actions.ts) is a "use server" action: every export there is
// a public POST endpoint, so it must start from `getCurrentMember()`. The cron
// scheduler (src/lib/automation/sweeper.ts) has no session — it sends a due
// SCHEDULED campaign on a timer. Both need the identical send logic, so it lives
// here, in a plain module, taking an explicit `{ db, companyId }` instead of a
// session. actions.ts imports these back so there is still ONE definition of the
// send, the bindings check, and the chunk size.

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign as campaignTable, message as messageTable } from "@/db/schema";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";
import { tagCampaignMessages } from "@/lib/campaign-messages";
import { resolveAudience, type ContactRow } from "./audience";
import {
  applyParams,
  resolveSendParams,
  templateBindingGaps,
  type VarBinding,
  type VarContext,
} from "@/lib/automation/vars";
import { resolveSendBindings } from "@/lib/whatsapp/templateBindings";
import {
  sendBlocker,
  unpackSpec,
  type CampaignSpec,
  type CampaignStats,
  type SendResult,
} from "./spec";

export type Db = ReturnType<typeof getDb>;

/** A second caller found the campaign held by another send (stats.lease). */
export const CAMPAIGN_BUSY =
  "This campaign is being sent right now (another tab, another person or the scheduler). It carries on by itself — refresh in a minute to see progress.";

/** Statuses a campaign may still be edited, scheduled or sent from. */
export const EDITABLE = ["draft", "scheduled"];

// Recipients sent per request. A whole broadcast in one request runs the Worker
// out of its CPU/subrequest budget partway through (a 50-recipient send stalled
// at ~32 on 2026-09-21), leaving the campaign stuck "sending" and the rest
// unsent. So the send does one chunk and returns how many remain; the caller
// loops. Kept well under where the single-request send died.
export const SEND_CHUNK = 20;

/**
 * How long one caller holds a campaign while it sends a chunk (stats.lease).
 * A chunk of SEND_CHUNK sends takes seconds; the lease only matters when a
 * caller dies mid-chunk (tab closed, Worker killed), and then the campaign is
 * free again after this long — the cron resumes it (sweeper.ts).
 */
export const LEASE_SECONDS = 300;

/** inArray has a parameter ceiling; the failure sweep runs in slices. */
export const ID_CHUNK = 500;

/** A contact row as the variable resolver wants it. */
export function varContext(c: ContactRow): VarContext {
  return {
    full_name: c.name,
    phone: c.phone,
    email: c.email,
    source: c.source,
    sourceId: c.sourceId,
    sourceUrl: c.sourceUrl,
    attributes: c.attributes,
  };
}

export interface Ready {
  ok: true;
  language: string;
  bindings: VarBinding[];
}

/**
 * Steps 1 and 2 of the send contract: merge the template's saved mapping with
 * this campaign's override, then refuse outright if any {{n}} is still unmapped.
 * An unmapped slot does not fail loudly at Meta — it sends, and the customer
 * reads "Reference No. : -", so refusing a whole broadcast of that is right.
 */
export async function readyBindings(
  companyId: string,
  spec: CampaignSpec
): Promise<Ready | { ok: false; error: string }> {
  const resolution = await resolveSendBindings(
    companyId,
    spec.templateName,
    spec.templateLang,
    spec.bindings
  );
  const gaps = templateBindingGaps(spec.templateBody, resolution.bindings);
  if (gaps.length > 0) {
    return {
      ok: false,
      error: `${gaps.map((n) => `{{${n}}}`).join(", ")} ${gaps.length === 1 ? "has" : "have"} nothing to fill ${gaps.length === 1 ? "it" : "them"}. Map ${gaps.length === 1 ? "it" : "them"} in step 4, or every recipient reads a dash there.`,
    };
  }
  return { ok: true, language: resolution.language, bindings: resolution.bindings };
}

export async function countFailed(db: Db, ids: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const slice = ids.slice(i, i + ID_CHUNK);
    const rows = await db
      .select({ id: messageTable.id })
      .from(messageTable)
      .where(and(inArray(messageTable.id, slice), eq(messageTable.status, "FAILED")));
    failed += rows.length;
  }
  return failed;
}

/** SQL: nobody holds this campaign's lease (none, or it ran out). */
export const leaseFree = sql`(${campaignTable.stats} -> 'lease' is null or (${campaignTable.stats} -> 'lease' ->> 'until')::timestamptz < now())`;

/**
 * Take a campaign for one chunk: an atomic conditional UPDATE that moves it to
 * "sending" and sets stats.lease = { id, until } — only when it is still
 * draft / scheduled / sending AND nobody else holds the lease. The row comes
 * back with the progress (doneIds) as the previous holder left it. `busy` =
 * someone else is sending it now; otherwise it is finished (or gone).
 */
export async function claimCampaign(
  db: Db,
  companyId: string,
  campaignId: string
): Promise<
  | { ok: true; lease: string; claimed: typeof campaignTable.$inferSelect }
  | { ok: false; busy: boolean }
> {
  const lease = crypto.randomUUID();
  const [claimed] = await db
    .update(campaignTable)
    .set({
      status: "sending",
      stats: sql`jsonb_set(coalesce(${campaignTable.stats}, '{}'::jsonb), '{lease}', jsonb_build_object('id', ${lease}::text, 'until', now() + make_interval(secs => ${LEASE_SECONDS})))`,
    })
    .where(
      and(
        eq(campaignTable.id, campaignId),
        eq(campaignTable.companyId, companyId),
        inArray(campaignTable.status, [...EDITABLE, "sending"]),
        leaseFree
      )
    )
    .returning();
  if (claimed) return { ok: true, lease, claimed };
  const now = await db.query.campaign.findFirst({
    where: eq(campaignTable.id, campaignId),
    columns: { status: true },
  });
  return { ok: false, busy: now?.status === "sending" };
}

/**
 * Write a chunk's result and give the lease back (the new stats carry no
 * lease) — only if we still hold it. False = the lease ran out and another
 * caller took over; our write is dropped rather than overwrite theirs.
 */
export async function releaseCampaign(
  db: Db,
  campaignId: string,
  lease: string,
  status: "sending" | "failed" | "completed",
  stats: CampaignStats
): Promise<boolean> {
  const rows = await db
    .update(campaignTable)
    .set({ status, stats })
    .where(and(eq(campaignTable.id, campaignId), sql`${campaignTable.stats} -> 'lease' ->> 'id' = ${lease}`))
    .returning({ id: campaignTable.id });
  return rows.length === 1;
}

/**
 * Send a saved campaign for real, in chunks, with no session.
 *
 * The caller guards WHO may start it (the action checks the session + a confirm
 * token; the scheduler checks the campaign is due and approved). From here on the
 * guards are the same for both: the spec is re-read from the row, `sendBlocker`
 * and `readyBindings` run again, and the claim is an atomic conditional UPDATE
 * that takes a lease (stats.lease) — a second caller (double click, a second
 * tab, the cron) finds the lease held and stops, so a chunk cannot go out
 * twice. Progress is carried in stats.doneIds, read from the claimed row, so a
 * resumed chunk never re-sends. Returns how many recipients remain; the caller
 * loops while > 0.
 */
export async function sendCampaignChunk(
  db: Db,
  companyId: string,
  campaignId: string
): Promise<SendResult> {
  const row = await db.query.campaign.findFirst({
    where: and(eq(campaignTable.id, campaignId), eq(campaignTable.companyId, companyId)),
  });
  if (!row) return { ok: false, error: "Campaign not found." };

  if (row.requiresApproval && !row.approvedByMemberId) {
    return { ok: false, error: "This campaign is waiting for a manager to approve it." };
  }

  const spec = unpackSpec(row.audience);
  if (!spec) {
    return {
      ok: false,
      error:
        "This campaign was created before the composer stored its message, so there is nothing to send. Build it again.",
    };
  }
  const blocker = sendBlocker(spec);
  if (blocker) return { ok: false, error: blocker };
  const ready = await readyBindings(companyId, spec);
  if (!ready.ok) return { ok: false, error: ready.error };

  const resolved = await resolveAudience(db, companyId, spec.audience);
  if (resolved.recipients.length === 0) {
    return { ok: false, error: "Nobody in this audience can be messaged." };
  }

  // Claim it, with a LEASE. A draft/scheduled campaign starts sending; one
  // already "sending" is resumed for its next chunk. Anything else
  // (completed/failed) is refused.
  //
  // The lease (stats.lease = { id, until }) is what makes this one-at-a-time.
  // Before the 2026-11-28 audit fix the claim also accepted rows already in
  // "sending" with no owner, and the progress (doneIds) was read BEFORE the
  // claim — so two callers (the cron sending a due campaign while someone
  // pressed Send now on the Due banner, a double submit, a second tab) both
  // passed, both read the same doneIds and both sent the same 20 people. Now
  // only a caller whose conditional UPDATE sets the lease may send; a second
  // caller finds it held and stops. The progress is read FROM the claimed row
  // (after the previous holder's write), and the final write releases the
  // lease only if we still hold it. The lease runs on the database clock.
  const claim = await claimCampaign(db, companyId, row.id);
  if (!claim.ok) {
    if (claim.busy) return { ok: false, busy: true, error: CAMPAIGN_BUSY };
    return { ok: false, error: "This campaign has already been sent — duplicate it to send again." };
  }
  const { claimed, lease } = claim;
  const prevStats = (claimed.stats ?? null) as (CampaignStats & { lease?: unknown }) | null;

  // Who is left, tracked by contact id so re-resolving the audience in a
  // different order across chunks never re-sends or skips anyone.
  const done = new Set(prevStats?.doneIds ?? []);
  const pending = resolved.recipients.filter((p) => !done.has(p.id));
  const batch = pending.slice(0, SEND_CHUNK);

  const startedAt = prevStats?.startedAt ?? new Date().toISOString();
  const msgIds: string[] = [];
  for (const person of batch) {
    const { params } = resolveSendParams(spec.templateBody, varContext(person), ready.bindings);
    const convo = await getOrCreateConversation(row.channelId, person.id);
    // The body recorded on the message row is the RESOLVED template text, so the
    // inbox and System Logs show what the customer actually read rather than a
    // row of {{1}} placeholders.
    const msg = await sendOutbound(convo.id, applyParams(spec.templateBody, params), {
      isBot: true,
      type: "TEMPLATE",
      template: { name: spec.templateName, lang: ready.language, params },
    });
    if (msg) msgIds.push(msg.id);
    // Mark ATTEMPTED (a refusal included) so a bad number is not retried next chunk.
    done.add(person.id);
  }

  // Per-message campaign link, for read / replied stats (lib/campaign-messages.ts).
  await tagCampaignMessages(row.id, msgIds);

  // `sendOutbound` marks a row FAILED when Meta gives back no message id, so
  // "sent" here means Meta accepted it — not merely that a row was written.
  const failedThis = await countFailed(db, msgIds);
  const sentThis = msgIds.length - failedThis;
  const sent = (prevStats?.sent ?? 0) + sentThis;
  const failed = (prevStats?.failed ?? 0) + failedThis;
  const remaining = pending.length - batch.length;

  const stats: CampaignStats = {
    total: resolved.matched,
    sent,
    startedAt,
    ...(remaining > 0 ? {} : { finishedAt: new Date().toISOString() }),
    ...(failed > 0 ? { failed } : {}),
    ...(resolved.blocked > 0 ? { skippedBlocked: resolved.blocked } : {}),
    ...(resolved.optedOut > 0 ? { skippedOptedOut: resolved.optedOut } : {}),
    doneIds: [...done],
  };

  await releaseCampaign(db, row.id, lease, remaining > 0 ? "sending" : sent === 0 ? "failed" : "completed", stats);

  revalidatePath("/campaigns");
  revalidatePath("/inbox");
  return { ok: true, sent, failed, recipients: resolved.recipients.length, remaining };
}

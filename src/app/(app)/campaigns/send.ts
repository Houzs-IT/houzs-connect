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
import { and, eq, inArray } from "drizzle-orm";
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

/** Statuses a campaign may still be edited, scheduled or sent from. */
export const EDITABLE = ["draft", "scheduled"];

// Recipients sent per request. A whole broadcast in one request runs the Worker
// out of its CPU/subrequest budget partway through (a 50-recipient send stalled
// at ~32 on 2026-09-21), leaving the campaign stuck "sending" and the rest
// unsent. So the send does one chunk and returns how many remain; the caller
// loops. Kept well under where the single-request send died.
export const SEND_CHUNK = 20;

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

/**
 * Send a saved campaign for real, in chunks, with no session.
 *
 * The caller guards WHO may start it (the action checks the session + a confirm
 * token; the scheduler checks the campaign is due and approved). From here on the
 * guards are the same for both: the spec is re-read from the row, `sendBlocker`
 * and `readyBindings` run again, and the status claim is an atomic conditional
 * UPDATE from draft/scheduled to "sending" — a second caller (double click, a
 * second tick, a resume) finds no row to claim and stops, so a broadcast cannot
 * go out twice. Progress is carried in stats.doneIds so a resumed chunk never
 * re-sends. Returns how many recipients remain; the caller loops while > 0.
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

  // Claim it. A draft/scheduled campaign starts sending; one already "sending" is
  // THIS send resuming its next chunk. Anything else (completed/failed) is
  // refused. The atomic status set means two callers cannot both start the same
  // fresh campaign, and progress carried in stats.doneIds means a resume never
  // re-sends what an earlier chunk already did.
  const prevStats = (row.stats ?? null) as CampaignStats | null;
  const [claimed] = await db
    .update(campaignTable)
    .set({ status: "sending" })
    .where(
      and(
        eq(campaignTable.id, row.id),
        eq(campaignTable.companyId, companyId),
        inArray(campaignTable.status, [...EDITABLE, "sending"])
      )
    )
    .returning();
  if (!claimed) {
    return { ok: false, error: "This campaign has already been sent — duplicate it to send again." };
  }

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

  await db
    .update(campaignTable)
    .set({
      status: remaining > 0 ? "sending" : sent === 0 ? "failed" : "completed",
      stats,
    })
    .where(eq(campaignTable.id, row.id));

  revalidatePath("/campaigns");
  revalidatePath("/inbox");
  return { ok: true, sent, failed, recipients: resolved.recipients.length, remaining };
}

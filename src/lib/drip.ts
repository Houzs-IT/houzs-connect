// Drip campaign runtime: enrol a contact, remove them, drop them on reply, and
// the cron-driven sweep that sends each due step.
//
// A drip step sends an approved template (the only thing Meta delivers outside
// the 24h window), reusing the exact campaign contract: resolveSendBindings →
// resolveSendParams → applyParams, then sendOutbound. Enrolment and the sweep
// are reached from the automation engine (add_to_drip), the inbox, the inbound
// handler (remove-on-reply) and the cron tick.

import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import {
  contact as contactTable,
  dripCampaign,
  dripEnrollment,
  dripStep,
} from "@/db/schema";
import { ensureDripTables } from "@/db/ensure-drip";
import { dueAt } from "@/lib/automation/time";
import { varContext } from "@/app/(app)/campaigns/send";
import { resolveSendBindings } from "@/lib/whatsapp/templateBindings";
import { resolveSendParams, applyParams } from "@/lib/automation/vars";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";

/** Enrolments advanced per tick. */
const DRIP_BATCH = 100;

export type EnrollResult = "enrolled" | "exists" | "not_live" | "no_steps" | "not_found";

async function stepsOf(db: DB, dripId: string) {
  return db.query.dripStep.findMany({
    where: eq(dripStep.dripId, dripId),
    orderBy: asc(dripStep.position),
  });
}

/**
 * Enrol a contact into a live drip, due for its first step. A drip that is not
 * live, has no steps, or where the contact is already actively enrolled does
 * nothing (so re-firing add_to_drip never stacks a contact onto the same drip).
 */
export async function enrollContactInDrip(
  db: DB,
  dripId: string,
  contactId: string
): Promise<EnrollResult> {
  await ensureDripTables(db);
  const drip = await db.query.dripCampaign.findFirst({ where: eq(dripCampaign.id, dripId) });
  if (!drip) return "not_found";
  if (drip.status !== "live") return "not_live";
  const steps = await stepsOf(db, dripId);
  if (steps.length === 0) return "no_steps";

  const existing = await db.query.dripEnrollment.findFirst({
    where: and(
      eq(dripEnrollment.dripId, dripId),
      eq(dripEnrollment.contactId, contactId),
      eq(dripEnrollment.status, "active")
    ),
  });
  if (existing) return "exists";

  await db.insert(dripEnrollment).values({
    dripId,
    contactId,
    currentStep: 0,
    status: "active",
    nextRunAt: dueAt(steps[0].afterUnit, steps[0].afterAmount),
  });
  return "enrolled";
}

/** Un-enrol a contact from a drip (the remove_from_drip node / a manual action). */
export async function removeContactFromDrip(db: DB, dripId: string, contactId: string): Promise<void> {
  await ensureDripTables(db);
  await db
    .update(dripEnrollment)
    .set({ status: "removed", nextRunAt: null })
    .where(
      and(
        eq(dripEnrollment.dripId, dripId),
        eq(dripEnrollment.contactId, contactId),
        eq(dripEnrollment.status, "active")
      )
    );
}

/**
 * Drop a contact from any drip whose last-sent step has the
 * remove-after-replied toggle, because they just replied. Called from the
 * inbound handler. Best-effort — a reply must never fail on this.
 */
export async function removeRepliedEnrollments(db: DB, contactId: string): Promise<void> {
  await ensureDripTables(db);
  const active = await db.query.dripEnrollment.findMany({
    where: and(eq(dripEnrollment.contactId, contactId), eq(dripEnrollment.status, "active")),
  });
  for (const e of active) {
    if (e.currentStep <= 0) continue; // nothing sent yet, nothing to reply to
    const steps = await stepsOf(db, e.dripId);
    const lastSent = steps[e.currentStep - 1];
    if (lastSent?.removeAfterReplied) {
      await db
        .update(dripEnrollment)
        .set({ status: "removed", nextRunAt: null })
        .where(eq(dripEnrollment.id, e.id));
    }
  }
}

async function sendDripStep(
  db: DB,
  drip: typeof dripCampaign.$inferSelect,
  step: typeof dripStep.$inferSelect,
  contactId: string
): Promise<void> {
  if (!step.templateName) return; // a step with no template just advances
  const person = await db.query.contact.findFirst({ where: eq(contactTable.id, contactId) });
  if (!person) return;
  const ready = await resolveSendBindings(drip.companyId, step.templateName, step.templateLang ?? "en", []);
  const body = step.templateBody ?? "";
  const { params } = resolveSendParams(body, varContext(person), ready.bindings);
  const convo = await getOrCreateConversation(drip.channelId, contactId);
  // The recorded body is the resolved text, so the inbox shows what the customer
  // read (sendOutbound refuses a blocked contact and marks FAILED on no-id).
  await sendOutbound(convo.id, applyParams(body, params), {
    isBot: true,
    type: "TEMPLATE",
    template: { name: step.templateName, lang: ready.language, params },
  });
}

/**
 * Send every enrolment whose current step is due, then advance it. Claims each
 * enrolment (clearing next_run_at) before sending so two overlapping ticks can't
 * send the same step twice. Bounded per tick; the cron catches the rest.
 */
export async function advanceDueDripEnrollments(): Promise<{ sent: number }> {
  const db = getDb();
  await ensureDripTables(db).catch(() => {});
  const now = new Date();
  const due = await db
    .select({ id: dripEnrollment.id })
    .from(dripEnrollment)
    .where(
      and(
        eq(dripEnrollment.status, "active"),
        isNotNull(dripEnrollment.nextRunAt),
        lte(dripEnrollment.nextRunAt, now)
      )
    )
    .limit(DRIP_BATCH);

  const stepCache = new Map<string, (typeof dripStep.$inferSelect)[]>();
  let sent = 0;
  for (const { id } of due) {
    // Claim: clear next_run_at so a concurrent tick skips it. Returns the row we
    // need to act on only if THIS tick won the claim.
    const [claimed] = await db
      .update(dripEnrollment)
      .set({ nextRunAt: null })
      .where(
        and(
          eq(dripEnrollment.id, id),
          eq(dripEnrollment.status, "active"),
          isNotNull(dripEnrollment.nextRunAt),
          lte(dripEnrollment.nextRunAt, now)
        )
      )
      .returning({
        id: dripEnrollment.id,
        dripId: dripEnrollment.dripId,
        contactId: dripEnrollment.contactId,
        currentStep: dripEnrollment.currentStep,
      });
    if (!claimed) continue;

    const drip = await db.query.dripCampaign.findFirst({ where: eq(dripCampaign.id, claimed.dripId) });
    if (!drip) {
      await db.update(dripEnrollment).set({ status: "removed" }).where(eq(dripEnrollment.id, claimed.id));
      continue;
    }
    let steps = stepCache.get(claimed.dripId);
    if (!steps) {
      steps = await stepsOf(db, claimed.dripId);
      stepCache.set(claimed.dripId, steps);
    }

    const step = steps[claimed.currentStep];
    if (!step) {
      // Nothing left to send — the sequence is done.
      await db.update(dripEnrollment).set({ status: "completed" }).where(eq(dripEnrollment.id, claimed.id));
      continue;
    }

    try {
      await sendDripStep(db, drip, step, claimed.contactId);
      sent++;
    } catch {
      // A single bad send must not stop the sweep; transport logs its own errors.
    }

    const nextIdx = claimed.currentStep + 1;
    const nextStep = steps[nextIdx];
    if (nextStep) {
      await db
        .update(dripEnrollment)
        .set({ currentStep: nextIdx, nextRunAt: dueAt(nextStep.afterUnit, nextStep.afterAmount) })
        .where(eq(dripEnrollment.id, claimed.id));
    } else {
      await db
        .update(dripEnrollment)
        .set({ currentStep: nextIdx, status: "completed" })
        .where(eq(dripEnrollment.id, claimed.id));
    }
  }
  return { sent };
}

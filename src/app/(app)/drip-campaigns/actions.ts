"use server";

// Drip campaign mutations: create, save (name + steps), go live / pause, delete.
// Every export is a public POST endpoint, so each starts from getCurrentMember()
// + can(me, "campaigns") and matches the drip's companyId. The runtime (enrol,
// send, advance) lives in src/lib/drip.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel as channelTable, dripCampaign, dripEnrollment, dripStep } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { can } from "@/lib/permissions";
import { ensureDripTables } from "@/db/ensure-drip";
import type { DripStepInput } from "./spec";

async function ctx() {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "campaigns"))) return null;
  return { db: getDb(), companyId: me.companyId };
}

async function authorizeDrip(dripId: string) {
  if (!dripId) return null;
  const c = await ctx();
  if (!c) return null;
  await ensureDripTables(c.db);
  const row = await c.db.query.dripCampaign.findFirst({
    where: and(eq(dripCampaign.id, dripId), eq(dripCampaign.companyId, c.companyId)),
  });
  if (!row) return null;
  return { ...c, drip: row };
}

/** Create a drip (opens its page). Needs a WhatsApp channel to send from. */
export async function createDrip(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const c = await ctx();
  if (!c) return;
  await ensureDripTables(c.db);
  const channel = await c.db.query.channel.findFirst({ where: eq(channelTable.companyId, c.companyId) });
  if (!channel) return; // no number yet — the page shows why
  const [row] = await c.db
    .insert(dripCampaign)
    .values({ companyId: c.companyId, channelId: channel.id, name, status: "draft" })
    .returning();
  revalidatePath("/drip-campaigns");
  if (row) redirect(`/drip-campaigns?d=${row.id}`);
}

/** Rename a drip and replace its steps wholesale (positions re-numbered). */
export async function saveDrip(dripId: string, name: string, steps: DripStepInput[]) {
  const auth = await authorizeDrip(dripId);
  if (!auth) return { ok: false as const, error: "not found" };
  const clean = name.trim();
  if (!clean) return { ok: false as const, error: "A name is required" };

  await auth.db.update(dripCampaign).set({ name: clean }).where(eq(dripCampaign.id, dripId));
  await auth.db.delete(dripStep).where(eq(dripStep.dripId, dripId));
  if (steps.length) {
    await auth.db.insert(dripStep).values(
      steps.map((s, i) => ({
        dripId,
        position: i,
        afterUnit: s.afterUnit,
        afterAmount: Math.max(0, Math.floor(Number(s.afterAmount) || 0)),
        templateName: s.templateName || null,
        templateLang: s.templateLang || null,
        templateBody: s.templateBody || null,
        removeAfterReplied: !!s.removeAfterReplied,
      }))
    );
  }
  revalidatePath("/drip-campaigns");
  return { ok: true as const };
}

/** Live = contacts may be enrolled and advanced; draft = held. */
export async function setDripStatus(dripId: string, live: boolean) {
  const auth = await authorizeDrip(dripId);
  if (!auth) return { ok: false as const, error: "not found" };
  await auth.db
    .update(dripCampaign)
    .set({ status: live ? "live" : "draft" })
    .where(eq(dripCampaign.id, dripId));
  revalidatePath("/drip-campaigns");
  return { ok: true as const, live };
}

/** Delete a drip, its steps and its enrolments (no DB cascade on the text keys). */
export async function deleteDrip(dripId: string) {
  const auth = await authorizeDrip(dripId);
  if (!auth) return { ok: false as const, error: "not found" };
  await auth.db.delete(dripEnrollment).where(eq(dripEnrollment.dripId, dripId));
  await auth.db.delete(dripStep).where(eq(dripStep.dripId, dripId));
  await auth.db.delete(dripCampaign).where(eq(dripCampaign.id, dripId));
  revalidatePath("/drip-campaigns");
  return { ok: true as const };
}

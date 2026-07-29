"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation } from "@/db/schema";
import type { FlowGraph } from "@/lib/automation/types";

/** Persist the edited flow graph (nodes + positions + edges) for an automation. */
export async function saveAutomationGraph(automationId: string, graph: FlowGraph) {
  const db = getDb();
  await db
    .update(automation)
    .set({
      graph,
      version: sql`${automation.version} + 1`,
    })
    .where(eq(automation.id, automationId));
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
  return { ok: true };
}

/** Toggle an automation active/inactive. */
export async function setAutomationEnabled(automationId: string, enabled: boolean) {
  const db = getDb();
  await db
    .update(automation)
    .set({ enabled, status: enabled ? "PUBLISHED" : "DRAFT" })
    .where(eq(automation.id, automationId));
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
}

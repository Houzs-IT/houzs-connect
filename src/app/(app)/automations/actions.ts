"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { FlowGraph } from "@/lib/automation/types";

/** Persist the edited flow graph (nodes + positions + edges) for an automation. */
export async function saveAutomationGraph(automationId: string, graph: FlowGraph) {
  await db.automation.update({
    where: { id: automationId },
    data: {
      graph: graph as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
  return { ok: true };
}

/** Toggle an automation active/inactive. */
export async function setAutomationEnabled(automationId: string, enabled: boolean) {
  await db.automation.update({
    where: { id: automationId },
    data: { enabled, status: enabled ? "PUBLISHED" : "DRAFT" },
  });
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
}

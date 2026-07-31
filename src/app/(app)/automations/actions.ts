"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation, automationVersion } from "@/db/schema";
import {
  asGraph,
  TRIGGER_EVENT_TO_TYPE,
  type AutomationVersionSnapshot,
  type FlowGraph,
  type TriggerEvent,
} from "@/lib/automation/types";

const MAX_VERSIONS = 10;

/**
 * Self-apply the version-history table at runtime. Connect ensures its `connect`
 * tables from the app (Hyperdrive → Supabase) rather than relying on a migration
 * file having run against the shared DB, so a fresh deploy is safe. Idempotent.
 */
async function ensureAutomationVersionTable() {
  const db = getDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."automation_version" (
      "id" text PRIMARY KEY NOT NULL,
      "automation_id" text NOT NULL,
      "version" integer NOT NULL,
      "label" text,
      "status" text,
      "trigger_type" text,
      "trigger_config" jsonb,
      "graph" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "automation_version_automation_idx"
    ON "connect"."automation_version" ("automation_id")
  `);
}

interface TriggerPayload {
  event: TriggerEvent;
  keywords?: string[];
}

interface SaveOptions {
  /** true → publish Live (status PUBLISHED, enabled); false → keep as Draft. */
  publish?: boolean;
  trigger?: TriggerPayload;
  label?: string;
}

async function snapshotVersion(
  automationId: string,
  version: number,
  label: string,
  status: string,
  triggerType: string,
  triggerConfig: unknown,
  graph: FlowGraph
) {
  const db = getDb();
  await ensureAutomationVersionTable();
  await db.insert(automationVersion).values({
    automationId,
    version,
    label,
    status,
    triggerType,
    triggerConfig: triggerConfig as object,
    graph: graph as unknown as object,
  });
  // Keep only the newest MAX_VERSIONS snapshots for this automation.
  const rows = await db
    .select({ id: automationVersion.id })
    .from(automationVersion)
    .where(eq(automationVersion.automationId, automationId))
    .orderBy(desc(automationVersion.createdAt));
  const stale = rows.slice(MAX_VERSIONS).map((r) => r.id);
  for (const id of stale) {
    await db.delete(automationVersion).where(eq(automationVersion.id, id));
  }
}

/**
 * Persist the edited flow graph (nodes + positions + edges), bump the version,
 * optionally publish Live vs keep Draft, sync the trigger onto the row so the
 * dispatch engine fires it, and record a version-history snapshot (last 10 kept).
 */
export async function saveAutomationGraph(
  automationId: string,
  graph: FlowGraph,
  opts: SaveOptions = {}
) {
  const db = getDb();

  const set: Record<string, unknown> = {
    graph,
    version: sql`${automation.version} + 1`,
  };
  if (opts.trigger) {
    set.triggerType = TRIGGER_EVENT_TO_TYPE[opts.trigger.event] ?? opts.trigger.event;
    set.triggerConfig = {
      event: opts.trigger.event,
      keywords: opts.trigger.keywords ?? [],
    };
  }
  if (opts.publish != null) {
    set.status = opts.publish ? "PUBLISHED" : "DRAFT";
    set.enabled = opts.publish;
  }

  const [row] = await db
    .update(automation)
    .set(set)
    .where(eq(automation.id, automationId))
    .returning();

  if (row) {
    const label = opts.label ?? (opts.publish ? "Published" : "Saved as draft");
    await snapshotVersion(
      automationId,
      row.version,
      label,
      row.status,
      row.triggerType,
      row.triggerConfig,
      graph
    );
  }

  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
  return { ok: true, version: row?.version ?? null };
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

/** The last 10 saved snapshots for the history dialog (newest first). */
export async function listAutomationVersions(
  automationId: string
): Promise<AutomationVersionSnapshot[]> {
  await ensureAutomationVersionTable();
  const db = getDb();
  const rows = await db
    .select()
    .from(automationVersion)
    .where(eq(automationVersion.automationId, automationId))
    .orderBy(desc(automationVersion.createdAt))
    .limit(MAX_VERSIONS);
  return rows.map((r) => {
    const graph = asGraph(r.graph);
    return {
      id: r.id,
      version: r.version,
      label: r.label ?? "Snapshot",
      status: r.status,
      graph,
      triggerType: r.triggerType,
      createdAt: r.createdAt.toISOString(),
      nodeCount: graph.nodes.length,
    };
  });
}

/**
 * Restore a snapshot: write its graph back onto the automation as a new version
 * (and record the restore itself as a snapshot so history stays append-only).
 */
export async function restoreAutomationVersion(
  automationId: string,
  versionId: string
) {
  await ensureAutomationVersionTable();
  const db = getDb();
  const snap = await db.query.automationVersion.findFirst({
    where: and(
      eq(automationVersion.id, versionId),
      eq(automationVersion.automationId, automationId)
    ),
  });
  if (!snap) return { ok: false as const, error: "snapshot not found" };

  const graph = asGraph(snap.graph);
  const set: Record<string, unknown> = {
    graph,
    version: sql`${automation.version} + 1`,
  };
  if (snap.triggerType) set.triggerType = snap.triggerType;
  if (snap.triggerConfig != null) set.triggerConfig = snap.triggerConfig;

  const [row] = await db
    .update(automation)
    .set(set)
    .where(eq(automation.id, automationId))
    .returning();

  if (row) {
    await snapshotVersion(
      automationId,
      row.version,
      `Restored v${snap.version}`,
      row.status,
      row.triggerType,
      row.triggerConfig,
      graph
    );
  }

  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
  return { ok: true as const, version: row?.version ?? null };
}

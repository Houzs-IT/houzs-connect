"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  automationVersion,
  company as companyTable,
  contact as contactTable,
} from "@/db/schema";
import {
  asGraph,
  TRIGGER_EVENT_TO_TYPE,
  type AutomationVersionSnapshot,
  type FlowGraph,
  type TriggerEvent,
} from "@/lib/automation/types";
import { attrs } from "@/lib/format";
import {
  handleDriverEvent,
  handleErpWebhook,
  handleInboundMessage,
} from "@/lib/automation/dispatch";
import { startRun } from "@/lib/automation/engine";
import { getOrCreateConversation } from "@/lib/whatsapp/transport";

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
  callbackId?: string;
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
      callbackId: opts.trigger.callbackId ?? "",
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

// A stable demo contact used by the "Test run" button so repeated tests reuse one
// conversation instead of spawning throwaways. Seeded with a few order attributes
// so {{variables}} in the flow interpolate to something readable.
const TEST_CONTACT_PHONE = "60000000000";
const TEST_CONTACT_ATTRS: Record<string, string> = {
  ref_1: "TEST-0001",
  delivery_date_1: "2026/08/15",
  amount: "1200",
  order_total: "1200",
};

/**
 * Fire this automation once against a demo test contact and jump to the resulting
 * conversation so the builder can SEE the flow run. Invokes the same dispatch seam
 * the ERP/driver webhooks use (so ACTION_CALLBACK / WEBHOOK resolution is exercised
 * for real); if that seam fires nothing (e.g. the automation is still a Draft, so
 * the webhook filter skips it), it falls back to running this automation directly
 * so the test always produces a visible result.
 */
export async function testRunAutomation(automationId: string) {
  const db = getDb();
  const auto = await db.query.automation.findFirst({
    where: eq(automation.id, automationId),
  });
  if (!auto) return;
  const company = await db.query.company.findFirst({
    where: eq(companyTable.id, auto.companyId),
  });
  if (!company) return;

  // Ensure the demo contact exists for this company (idempotent).
  let contact = await db.query.contact.findFirst({
    where: and(
      eq(contactTable.companyId, auto.companyId),
      eq(contactTable.phone, TEST_CONTACT_PHONE)
    ),
  });
  if (!contact) {
    [contact] = await db
      .insert(contactTable)
      .values({
        companyId: auto.companyId,
        phone: TEST_CONTACT_PHONE,
        name: "Test Contact",
        source: "test-run",
        attributes: { ...TEST_CONTACT_ATTRS },
      })
      .returning();
  } else {
    contact = (
      await db
        .update(contactTable)
        .set({ attributes: { ...TEST_CONTACT_ATTRS, ...attrs(contact.attributes) } })
        .where(eq(contactTable.id, contact.id))
        .returning()
    )[0];
  }

  const cfg = (auto.triggerConfig ?? {}) as { callbackId?: string };
  let fired = 0;

  // Exercise the real dispatch handler for the automation's trigger type.
  switch (auto.triggerType) {
    case "ACTION_CALLBACK": {
      const callbackId = cfg.callbackId || auto.name;
      const res = await handleErpWebhook({
        companySlug: company.slug,
        phone: TEST_CONTACT_PHONE,
        name: "Test Contact",
        automation: callbackId,
        attributes: { ...TEST_CONTACT_ATTRS, status: callbackId },
      });
      fired = res.ok ? (res.runs?.length ?? 0) : 0;
      break;
    }
    case "WEBHOOK": {
      const res = await handleErpWebhook({
        companySlug: company.slug,
        phone: TEST_CONTACT_PHONE,
        name: "Test Contact",
        automation: auto.name,
        attributes: { ...TEST_CONTACT_ATTRS },
      });
      fired = res.ok ? (res.runs?.length ?? 0) : 0;
      break;
    }
    case "DRIVER_EVENT": {
      const res = await handleDriverEvent({
        companySlug: company.slug,
        phone: TEST_CONTACT_PHONE,
        event: "EN_ROUTE",
        driverName: "Demo Driver",
        carPlate: "TEST 1234",
        eta: "30 mins",
      });
      fired = res.ok ? (res.runs?.length ?? 0) : 0;
      break;
    }
    case "NEW_INCOMING_MESSAGE": {
      const res = await handleInboundMessage(contact.id, { text: "test" });
      fired = res.started + res.resumed;
      break;
    }
    default:
      break;
  }

  // Fallback: run THIS automation directly if the webhook filter fired nothing
  // (Draft/disabled, or a trigger type without a simple simulation).
  if (fired === 0) await startRun(automationId, contact.id);

  const convo = await getOrCreateConversation(auto.channelId, contact.id);
  revalidatePath(`/inbox/${convo.id}`);
  redirect(`/inbox/${convo.id}`);
}

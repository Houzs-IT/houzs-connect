import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation as automationTable,
  automationRun as automationRunTable,
  campaign as campaignTable,
} from "@/db/schema";
import { asGraph, type TriggerEvent } from "@/lib/automation/types";
import { FlowCanvas } from "@/components/automation/FlowCanvas";
import { testRunAutomation } from "../actions";

export default async function AutomationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const automation = await db.query.automation.findFirst({
    where: eq(automationTable.id, id),
    with: { channel: true },
  });
  if (!automation) notFound();

  const runCount = await db.$count(
    automationRunTable,
    eq(automationRunTable.automationId, id)
  );

  // Option lists for node pickers (jump-to-automation, drip campaigns).
  const [otherAutomations, campaigns] = await Promise.all([
    db.query.automation.findMany({
      where: and(
        eq(automationTable.companyId, automation.companyId),
        ne(automationTable.id, id)
      ),
      columns: { id: true, name: true },
    }),
    db.query.campaign.findMany({
      where: eq(campaignTable.companyId, automation.companyId),
      columns: { id: true, name: true },
    }),
  ]);

  const graph = asGraph(automation.graph);
  const triggerConfig =
    (automation.triggerConfig as {
      event?: TriggerEvent;
      callbackId?: string;
      keywords?: string[];
    } | null) ?? null;

  // Server action bound to this automation for the header "Test run" button.
  const runTest = testRunAutomation.bind(null, automation.id);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
        <Link
          href="/automations"
          className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          ← Automations
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-[var(--color-ink)]">
            {automation.name}
          </h1>
          <p className="truncate text-[11.5px] text-[var(--color-muted)]">
            {automation.channel.displayName} · v{automation.version} · {runCount} runs
          </p>
        </div>
        {/* Fire the flow against a demo test contact, then jump to its conversation. */}
        <form action={runTest} className="ml-auto shrink-0">
          <button
            type="submit"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            Test run
          </button>
        </form>
      </header>

      <FlowCanvas
        automationId={automation.id}
        graph={graph}
        initialEnabled={automation.enabled}
        initialTriggerEvent={triggerConfig?.event}
        initialCallbackId={triggerConfig?.callbackId ?? ""}
        initialKeywords={triggerConfig?.keywords ?? []}
        automations={otherAutomations}
        campaigns={campaigns}
      />
    </>
  );
}

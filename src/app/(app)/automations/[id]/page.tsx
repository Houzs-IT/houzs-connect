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
    (automation.triggerConfig as { event?: TriggerEvent; keywords?: string[] } | null) ??
    null;

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
      </header>

      <FlowCanvas
        automationId={automation.id}
        graph={graph}
        initialEnabled={automation.enabled}
        initialTriggerEvent={triggerConfig?.event}
        initialKeywords={triggerConfig?.keywords ?? []}
        automations={otherAutomations}
        campaigns={campaigns}
      />
    </>
  );
}

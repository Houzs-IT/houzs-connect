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
import { getCurrentMember } from "@/lib/current-member";
import { FlowChecks } from "../FlowChecks";
import { PublishControl } from "../PublishControl";
import {
  findFlowGaps,
  parseImportNote,
  summariseSends,
  triggerSentence,
  type NodeProbe,
} from "../copy";
import { testRunAutomation } from "../actions";

export default async function AutomationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The builder loaded any automation by id with no company check — one tenant
  // could open, edit, publish and test-run another tenant's live flow just by
  // holding its id. Scoped like `settings/page.tsx`.
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  const automation = await db.query.automation.findFirst({
    where: and(
      eq(automationTable.id, id),
      eq(automationTable.companyId, me.companyId)
    ),
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

  // Same gap analysis the list runs, from the graph that is already loaded here.
  const probes: NodeProbe[] = graph.nodes.map((n) => ({
    t: n.type,
    m: typeof n.data?.memberId === "string" ? n.data.memberId : null,
    d: typeof n.data?.departmentId === "string" ? n.data.departmentId : null,
  }));
  const gaps = findFlowGaps(probes);
  const sends = summariseSends(probes);
  const importNote = parseImportNote(automation.description);
  const sentence = triggerSentence(
    automation.triggerType,
    automation.name,
    triggerConfig
  );

  // Server action bound to this automation for the header "Test run" button.
  const runTest = testRunAutomation.bind(null, automation.id);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
        <Link
          href="/automations"
          className="shrink-0 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          ← Automations
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-ink)]">
              {automation.name}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                automation.enabled
                  ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
              }`}
            >
              {automation.enabled ? "Live" : "Draft"}
            </span>
          </div>
          <p className="truncate text-[11.5px] text-[var(--color-muted)]">
            {automation.channel.displayName} · runs {sentence} · v
            {automation.version} · {runCount} runs
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {(gaps.length > 0 || importNote.approximations != null) && (
            <FlowChecks
              name={automation.name}
              gaps={gaps}
              importApproximations={importNote.approximations}
              size="md"
            />
          )}
          {/* Fire the flow against a demo test contact, then jump to its conversation. */}
          <form action={runTest}>
            <button
              type="submit"
              title="Runs this flow once against the built-in test contact, not a real customer."
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              Test run
            </button>
          </form>
          <PublishControl
            size="md"
            facts={{
              id: automation.id,
              name: automation.name,
              enabled: automation.enabled,
              triggerSentence: sentence,
              messageSteps: sends.messageSteps,
              apiSteps: sends.apiSteps,
              gapCount: gaps.reduce((n, g) => n + g.count, 0),
              stopCount: gaps
                .filter((g) => g.severity === "stops")
                .reduce((n, g) => n + g.count, 0),
            }}
          />
        </div>
      </header>

      <FlowCanvas
        automationId={automation.id}
        automationName={automation.name}
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

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
import { runStats } from "@/lib/automation/run-stats";
import { relTime } from "@/lib/format";

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
  const stats = await runStats(automation.id, automation.graph);
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
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Link
          href="/automations"
          aria-label="Back to automations"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{automation.name}</h1>
            <span
              className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                automation.enabled
                  ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
              }`}
            >
              {automation.enabled ? "Live" : "Draft"}
            </span>
            <span className="shrink-0 text-[11.5px] text-[var(--color-faint)]">
              v{automation.version} · {relTime(automation.updatedAt)} · {runCount} runs
            </span>
          </div>
          <p className="truncate text-[11.5px] text-[var(--color-muted)]">
            Runs {sentence} · {automation.channel.displayName}
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
              className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
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
        runStats={stats}
      />
    </div>
  );
}

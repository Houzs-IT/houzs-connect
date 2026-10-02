import { notFound } from "next/navigation";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation, automationRun, channel } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { createAutomation } from "./actions";
import { AutomationCard, type AutomationCardData } from "./AutomationCard";
import {
  CREATABLE_TRIGGERS,
  findFlowGaps,
  parseImportNote,
  summariseSends,
  triggerSentence,
  type NodeProbe,
  type TriggerConfigShape,
} from "./copy";

export default async function AutomationsPage() {
  // This page listed EVERY company's automations: no `getCurrentMember()`, no
  // company filter, just `.from(automation).innerJoin(channel)`. One tenant's
  // flow names, trigger types and node counts were on another tenant's screen,
  // and the row actions added here (publish, delete) would have acted on them.
  // Scoped the same way `settings/page.tsx` does.
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  const [rows, runCounts, defaultChannel] = await Promise.all([
    db
      .select({
        id: automation.id,
        name: automation.name,
        description: automation.description,
        triggerType: automation.triggerType,
        triggerConfig: automation.triggerConfig,
        enabled: automation.enabled,
        version: automation.version,
        updatedAt: automation.updatedAt,
        channelName: channel.displayName,
        // The card needs counts and a per-node-type breakdown, not the graph.
        // `jsonb_array_length` errors on a non-array and `graph` is nullable and
        // free-form, so every expression gates on the type first.
        nodeCount:
          sql<number>`coalesce(case when jsonb_typeof(${automation.graph} -> 'nodes') = 'array' then jsonb_array_length(${automation.graph} -> 'nodes') end, 0)`.mapWith(
            Number
          ),
        edgeCount:
          sql<number>`coalesce(case when jsonb_typeof(${automation.graph} -> 'edges') = 'array' then jsonb_array_length(${automation.graph} -> 'edges') end, 0)`.mapWith(
            Number
          ),
        // Three scalars per node instead of the whole node — enough to work out
        // which steps are placeholders, without shipping a 184-node graph per
        // card to the Worker just to render a list.
        probes: sql<NodeProbe[]>`coalesce(case when jsonb_typeof(${automation.graph} -> 'nodes') = 'array' then (
          select jsonb_agg(jsonb_build_object(
            't', n ->> 'type',
            'm', n -> 'data' ->> 'memberId',
            'd', n -> 'data' ->> 'departmentId'
          ))
          from jsonb_array_elements(${automation.graph} -> 'nodes') n
        ) end, '[]'::jsonb)`,
      })
      .from(automation)
      .innerJoin(channel, eq(channel.id, automation.channelId))
      .where(eq(automation.companyId, me.companyId))
      .orderBy(desc(automation.updatedAt)),
    // Run totals counted in Postgres, joined through `automation` so another
    // company's runs can never land in this map.
    db
      .select({ automationId: automationRun.automationId, n: count() })
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(eq(automation.companyId, me.companyId))
      .groupBy(automationRun.automationId),
    db.query.channel.findFirst({
      where: eq(channel.companyId, me.companyId),
      orderBy: [desc(channel.isDefault), asc(channel.displayName)],
    }),
  ]);

  const runsByAutomation = new Map(runCounts.map((r) => [r.automationId, r.n]));

  const cards: AutomationCardData[] = rows.map((a) => {
    const probes = Array.isArray(a.probes) ? a.probes : [];
    const note = parseImportNote(a.description);
    const cfg = (a.triggerConfig ?? null) as TriggerConfigShape | null;
    const sends = summariseSends(probes);
    return {
      id: a.id,
      name: a.name,
      note: note.rest,
      imported: note.imported,
      importApproximations: note.approximations,
      channelName: a.channelName,
      triggerLabel: a.triggerType,
      triggerSentence: triggerSentence(a.triggerType, a.name, cfg),
      enabled: a.enabled,
      version: a.version,
      nodeCount: a.nodeCount,
      edgeCount: a.edgeCount,
      runCount: runsByAutomation.get(a.id) ?? 0,
      updatedLabel: relTime(a.updatedAt),
      messageSteps: sends.messageSteps,
      apiSteps: sends.apiSteps,
      gaps: findFlowGaps(probes),
    };
  });

  const liveCount = cards.filter((c) => c.enabled).length;

  return (
    <PageChrome section="automations" page="allFlows">
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        {/* ── New automation ─────────────────────────────────── */}
        <form
          action={createAutomation}
          className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card"
        >
          <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">
            New automation
          </h3>
          <p className="mb-3 text-[11px] text-[var(--color-faint)]">
            It starts as a draft and is switched off. Nothing is sent until you
            publish it.
          </p>

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Name</label>
          <input
            name="name"
            required
            placeholder="e.g. Delivery date confirmation"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            When should it run?
          </label>
          <select
            name="triggerType"
            defaultValue="NEW_INCOMING_MESSAGE"
            className="mb-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          >
            {CREATABLE_TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <ul className="mb-3 flex flex-col gap-1">
            {CREATABLE_TRIGGERS.map((t) => (
              <li key={t.value} className="text-[10.5px] leading-snug text-[var(--color-faint)]">
                <span className="text-[var(--color-muted)]">{t.label}</span> — {t.hint}
              </li>
            ))}
          </ul>

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            Action id (only for “The ERP sends an action”)
          </label>
          <input
            name="callbackId"
            placeholder="e.g. To Send Delivery Date"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            Note (optional)
          </label>
          <textarea
            name="description"
            rows={2}
            placeholder="What this flow is for, in your own words"
            className="mb-3 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
          />

          <button
            type="submit"
            disabled={!defaultChannel}
            className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Create draft &amp; open builder
          </button>
          {!defaultChannel && (
            <p className="mt-2 text-[11px] text-[var(--color-danger)]">
              This company has no WhatsApp number connected yet, so an automation
              has nothing to send from.
            </p>
          )}
        </form>

        {/* ── The list ───────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3">
          {cards.length > 0 && (
            <p className="text-[11.5px] text-[var(--color-faint)]">
              {cards.length} automation{cards.length === 1 ? "" : "s"} ·{" "}
              {liveCount === 0
                ? "none is live — nothing runs on its own yet"
                : `${liveCount} live, ${cards.length - liveCount} draft`}
            </p>
          )}

          {cards.length === 0 && (
            <div className="dot-grid grid min-h-[200px] place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-center">
              <div className="px-6">
                <p className="text-[13px] font-medium text-[var(--color-ink)]">
                  No automations yet
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                  Make one on the left. You get a flow builder — a searchable list
                  of steps, message and tag steps, branching, drafts and version
                  history — and nothing is sent to anyone until you publish it.
                </p>
              </div>
            </div>
          )}

          {cards.map((a) => (
            <AutomationCard key={a.id} a={a} />
          ))}
        </div>
      </div>
    </PageChrome>
  );
}

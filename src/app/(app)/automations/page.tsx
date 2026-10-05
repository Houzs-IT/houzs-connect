import { notFound } from "next/navigation";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation, automationRun, channel } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { AutomationActions, AutomationName, AutomationStatus, type AutomationCardData } from "./AutomationCard";
import { NewAutomation } from "./NewAutomation";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import {
  CREATABLE_TRIGGERS,
  findFlowGaps,
  parseImportNote,
  summariseSends,
  triggerSentence,
  type NodeProbe,
  type TriggerConfigShape,
} from "./copy";

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; trigger?: string }>;
}) {
  const sp = await searchParams;
  // This page listed EVERY company's automations: no `getCurrentMember()`, no
  // company filter, just `.from(automation).innerJoin(channel)`. One tenant's
  // flow names, trigger types and node counts were on another tenant's screen,
  // and the row actions added here (publish, delete) would have acted on them.
  // Scoped the same way `settings/page.tsx` does.
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  const week = last7();
  const dayExpr = sql<string>`to_char(date_trunc('day', ${automationRun.createdAt} at time zone 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD')`;
  const [rows, runCounts, defaultChannel, daily] = await Promise.all([
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
    // Runs started per day over the last seven Malaysian days, for the sparkline.
    db
      .select({ automationId: automationRun.automationId, day: dayExpr, n: count() })
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(and(eq(automation.companyId, me.companyId), gte(automationRun.createdAt, week.since)))
      .groupBy(automationRun.automationId, dayExpr),
  ]);
  const dailyBy = new Map<string, Map<string, number>>();
  for (const d of daily) {
    const m = dailyBy.get(d.automationId) ?? new Map<string, number>();
    m.set(d.day, d.n);
    dailyBy.set(d.automationId, m);
  }

  const runsByAutomation = new Map(runCounts.map((r) => [r.automationId, r.n]));

  const t = await getDict();
  const rel = (d: Date) => {
    const r = relTime(d);
    return /^\d+[mhd]$/.test(r) ? fmt(t.autos.ago, { t: r }) : r;
  };
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
      updatedLabel: rel(a.updatedAt),
      updatedAt: a.updatedAt.getTime(),
      messageSteps: sends.messageSteps,
      apiSteps: sends.apiSteps,
      gaps: findFlowGaps(probes),
      daily: week.days.map((k) => dailyBy.get(a.id)?.get(k) ?? 0),
      runs7: week.days.reduce((n, k) => n + (dailyBy.get(a.id)?.get(k) ?? 0), 0),
      triggerDetail: cfg?.callbackId || (cfg?.keywords?.length ? cfg.keywords.join(", ") : null),
    };
  });

  const liveCount = cards.filter((c) => c.enabled).length;
  const needs = (c: AutomationCardData) => c.gaps.length > 0 || c.importApproximations != null;
  // The left menu's status / trigger links narrow the list here; searching,
  // sorting and the column filters then run in the table over what is left.
  // (The old `?q=` search only matched names over these same loaded rows, so
  // the table's own search replaces it.)
  const shown = cards.filter((c) => {
    if (sp.status === "live" && !c.enabled) return false;
    if (sp.status === "draft" && c.enabled) return false;
    if (sp.status === "check" && !needs(c)) return false;
    if (sp.trigger && c.triggerLabel !== sp.trigger) return false;
    return true;
  });
  const L = t.autos;
  // The everyday triggers are always listed, the rest only when used.
  const byTrigger = new Map<string, number>(["ACTION_CALLBACK", "NEW_INCOMING_MESSAGE", "TAG_ADDED"].map((k) => [k, 0]));
  for (const c of cards) byTrigger.set(c.triggerLabel, (byTrigger.get(c.triggerLabel) ?? 0) + 1);

  const columns: DataColumn[] = [
    // `max-w-0` with a share of the width lets the long names and trigger
    // details truncate instead of stretching the table.
    { key: "name", label: L.colName, className: "w-[32%] max-w-0" },
    { key: "when", label: L.colWhen, className: "w-[22%] max-w-0" },
    { key: "runs", label: L.colRuns, filter: false },
    { key: "edited", label: L.colEdited, filter: false },
    { key: "status", label: L.colStatus },
    { key: "actions", label: "", sort: false, filter: false, className: "w-[60px]" },
  ];
  const tableRows: DataRow[] = shown.map((a) => {
    const trigger = L.triggers[a.triggerLabel] ?? a.triggerLabel;
    const status = a.enabled ? L.live : L.draft;
    return {
      id: a.id,
      search: [a.triggerDetail, a.note].filter(Boolean).join(" "),
      sort: { name: a.name, when: trigger, runs: a.runs7, edited: a.updatedAt, status },
      text: { name: a.name, when: trigger, edited: a.updatedLabel, status },
      cells: {
        name: <AutomationName a={a} />,
        when: (
          <div className="min-w-0">
            <div className="truncate text-[12.5px] text-[var(--color-ink)]">{trigger}</div>
            <div className="truncate text-[11.5px] text-[var(--color-faint)]" title={a.triggerSentence}>
              {a.triggerDetail ?? L.triggerSub[a.triggerLabel] ?? a.channelName}
            </div>
          </div>
        ),
        runs: <RunsCell a={a} last7={L.last7} />,
        edited: (
          <div className="whitespace-nowrap leading-tight">
            <div className="text-[12.5px] text-[var(--color-ink)]">{a.updatedLabel}</div>
            <div className="text-[10.5px] text-[var(--color-faint)]">v{a.version}</div>
          </div>
        ),
        status: <AutomationStatus a={a} />,
        actions: <AutomationActions a={a} />,
      },
    };
  });

  return (
    <>
      <SecondaryMenu
        title={t.nav.automations}
        groups={[
          {
            title: L.status,
            items: [
              { href: "?", label: L.all, count: cards.length },
              { href: "?status=live", label: L.live, count: liveCount, dot: "var(--color-success)" },
              { href: "?status=draft", label: L.draft, count: cards.length - liveCount, dot: "var(--color-border-strong)" },
              { href: "?status=check", label: L.needsCheck, count: cards.filter(needs).length, dot: "var(--color-pastel-orange-ink)" },
            ],
          },
          {
            title: L.trigger,
            items: [...byTrigger.entries()].map(([k, n]) => ({
              href: `?trigger=${encodeURIComponent(k)}`,
              label: L.triggers[k] ?? k,
              count: n,
            })),
          },
          {
            title: L.tools,
            items: [
              { href: "/settings/auto-replies", label: L.autoReplies },
              { href: "/logs", label: L.runLogs, exact: true },
            ],
          },
        ]}
      />
      <PageChrome
        section="automations"
        page="allFlows"
        actions={<NewAutomation triggers={CREATABLE_TRIGGERS} canCreate={!!defaultChannel} />}
      >
        <div className="flex flex-col gap-4 p-4 md:p-6">
          <DataTable
            columns={columns}
            rows={tableRows}
            searchPlaceholder={L.search}
            empty={cards.length ? L.noMatch : L.none}
            toolbar={
              <span className="text-[12px] text-[var(--color-faint)]">
                {fmt(L.summary, { n: cards.length, live: liveCount })}
              </span>
            }
            minWidth={900}
            stateKey="automations"
          />
        </div>
      </PageChrome>
    </>
  );
}

/** Runs column: the last seven days as a sparkline, with their total. */
function RunsCell({ a, last7 }: { a: AutomationCardData; last7: string }) {
  const max = Math.max(1, ...a.daily);
  const spark = a.daily
    .map((v, i) => `${(i / Math.max(1, a.daily.length - 1)) * 56},${18 - (v / max) * 16}`)
    .join(" ");
  return (
    <div className="flex items-center gap-2.5">
      <svg width="56" height="20" viewBox="0 0 56 20" className="shrink-0" aria-hidden>
        <polyline points={spark} fill="none" stroke={a.runs7 ? "var(--color-accent)" : "var(--color-border-strong)"} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="leading-tight">
        <div className="text-[12.5px] font-semibold tabular-nums text-[var(--color-ink)]">{a.runs7}</div>
        <div className="whitespace-nowrap text-[10.5px] text-[var(--color-faint)]">{last7}</div>
      </div>
    </div>
  );
}

/** The last seven Malaysian days (keys YYYY-MM-DD) and the instant they start. */
function last7() {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const today = new Date(`${key(new Date())}T00:00:00+08:00`);
  const days = Array.from({ length: 7 }, (_, i) => key(new Date(today.getTime() - (6 - i) * 86_400_000)));
  return { since: new Date(today.getTime() - 6 * 86_400_000), days };
}

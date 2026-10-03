import { notFound } from "next/navigation";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation, automationRun, channel } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { AutomationCard, type AutomationCardData } from "./AutomationCard";
import { NewAutomation } from "./NewAutomation";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { IconSearch } from "@/components/icons";
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
  searchParams: Promise<{ q?: string; status?: string; trigger?: string }>;
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
      daily: week.days.map((k) => dailyBy.get(a.id)?.get(k) ?? 0),
      runs7: week.days.reduce((n, k) => n + (dailyBy.get(a.id)?.get(k) ?? 0), 0),
      triggerDetail: cfg?.callbackId || (cfg?.keywords?.length ? cfg.keywords.join(", ") : null),
    };
  });

  const liveCount = cards.filter((c) => c.enabled).length;
  const needs = (c: AutomationCardData) => c.gaps.length > 0 || c.importApproximations != null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = cards.filter((c) => {
    if (sp.status === "live" && !c.enabled) return false;
    if (sp.status === "draft" && c.enabled) return false;
    if (sp.status === "check" && !needs(c)) return false;
    if (sp.trigger && c.triggerLabel !== sp.trigger) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const t = await getDict();
  const L = t.autos;
  const byTrigger = new Map<string, number>();
  for (const c of cards) byTrigger.set(c.triggerLabel, (byTrigger.get(c.triggerLabel) ?? 0) + 1);
  const cols =
    "grid-cols-[minmax(0,2.4fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_36px]";

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
          <div className="flex flex-wrap items-center gap-3">
            <form className="flex h-[38px] w-full max-w-[320px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)]">
              {sp.status && <input type="hidden" name="status" value={sp.status} />}
              {sp.trigger && <input type="hidden" name="trigger" value={sp.trigger} />}
              <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
              <input
                name="q"
                defaultValue={sp.q ?? ""}
                placeholder={L.search}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]"
              />
            </form>
            <span className="ml-auto text-[12px] text-[var(--color-faint)]">
              {fmt(L.summary, { n: cards.length, live: liveCount })}
            </span>
          </div>

          <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="min-w-[900px]">
              <div
                className={`grid ${cols} gap-3 border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]`}
              >
                <span>{L.colName}</span>
                <span>{L.colWhen}</span>
                <span>{L.colRuns}</span>
                <span>{L.colEdited}</span>
                <span>{L.colStatus}</span>
                <span />
              </div>
              {shown.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {cards.length ? L.noMatch : L.none}
                </p>
              ) : (
                shown.map((a) => <AutomationCard key={a.id} a={a} />)
              )}
            </div>
          </div>
        </div>
      </PageChrome>
    </>
  );
}

/** The last seven Malaysian days (keys YYYY-MM-DD) and the instant they start. */
function last7() {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const today = new Date(`${key(new Date())}T00:00:00+08:00`);
  const days = Array.from({ length: 7 }, (_, i) => key(new Date(today.getTime() - (6 - i) * 86_400_000)));
  return { since: new Date(today.getTime() - 6 * 86_400_000), days };
}

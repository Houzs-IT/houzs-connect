import type { Dict } from "@/lib/i18n/dict";
import { Skel } from "@/components/skeleton";
import { AreaChart } from "./charts";
import { agentsReport, supportStats } from "./queries";
import { Avatar, Badge, Card, EYEBROW, Empty } from "./ui";
import { delta, humanDuration, type PeriodWindow } from "./util";
import { DeptFilter } from "./DeptFilter";

type S = Dict["dash"];

export async function SupportTab({
  companyId,
  w,
  s,
  dept,
}: {
  companyId: string;
  w: PeriodWindow;
  s: S;
  dept?: string;
}) {
  const [stats, report] = await Promise.all([
    supportStats(companyId, w),
    agentsReport(companyId, w, dept),
  ]);
  const kpis: { label: string; hint: string; dot: string; now: number; prev: number }[] = [
    { label: s.k1, hint: s.k1Hint, dot: "var(--color-accent)", now: stats.cur.total, prev: stats.prev.total },
    { label: s.k2, hint: s.k2Hint, dot: "#4fb0c6", now: stats.cur.open, prev: stats.prev.open },
    { label: s.k3, hint: s.k3Hint, dot: "var(--color-success)", now: stats.cur.closed, prev: stats.prev.closed },
    { label: s.k4, hint: s.k4Hint, dot: "var(--color-danger)", now: stats.cur.queue, prev: stats.prev.queue },
  ];
  const cols = "grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,0.8fr))_repeat(2,minmax(0,1.2fr))]";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const d = delta(k.now, k.prev);
          return (
            <Card key={k.label} pad="px-5 py-[18px]">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: k.dot }} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{k.label}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[32px] font-medium tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">{k.now}</span>
                {d != null && (
                  <span className={`text-[11.5px] font-semibold ${d >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                    {d >= 0 ? "↗" : "↘"} {Math.abs(d).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-[var(--color-faint)]">{k.hint}</div>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="mb-2.5 flex flex-wrap items-center gap-3.5">
          <span className={`flex-1 ${EYEBROW}`}>{s.supOverview}</span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
            <span className="h-[2px] w-3.5 bg-[var(--color-accent)]" />
            {s.supTotal}
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
            <span className="h-[2px] w-3.5 bg-[var(--color-brand)]" />
            {s.supAssigned}
          </span>
        </div>
        <AreaChart
          id="sup"
          labels={w.buckets.map((b) => b.label)}
          series={[
            { name: s.supTotal, color: "var(--color-accent)", points: stats.series.map((d) => d.total) },
            { name: s.supAssigned, color: "var(--color-brand)", points: stats.series.map((d) => d.assigned), dashed: true },
          ]}
        />
      </Card>

      <Card pad="p-0" className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-[22px] py-[18px]">
          <span className={EYEBROW}>{s.agentsReport}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            {s.totalAgents} <b className="font-semibold text-[var(--color-ink)]">{report.list.length}</b>
          </span>
          <DeptFilter depts={report.depts} value={dept ?? ""} allLabel={s.allDepts} />
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`grid ${cols} gap-2 border-y border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-[22px] py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-faint)]`}>
              <span>{s.colName}</span>
              <span>{s.colAssigned}</span>
              <span>{s.colOpen}</span>
              <span>{s.colClosed}</span>
              <span>{s.colFirst}</span>
              <span>{s.colAvg}</span>
            </div>
            {report.list.length === 0 ? (
              <div className="px-[22px] py-4">
                <Empty>{s.noData}</Empty>
              </div>
            ) : (
              report.list.map((a) => (
                <div
                  key={a.id}
                  className={`grid ${cols} items-center gap-2 border-b border-[var(--color-border-subtle)] px-[22px] py-[11px] text-[12.5px] tabular-nums hover:bg-[var(--color-surface-2)]`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={a.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--color-ink)]">{a.name}</span>
                      {a.dept && <span className="block text-[11px] text-[var(--color-faint)]">{a.dept}</span>}
                    </span>
                  </span>
                  <span>{a.assigned}</span>
                  <span className="font-semibold">{a.open}</span>
                  <span>{a.closed}</span>
                  <span className="flex items-center gap-1.5">
                    {a.first == null ? "—" : humanDuration(a.first)}
                    {a.onTime != null && <Badge tone={a.onTime ? "success" : "danger"}>{a.onTime ? s.onTime : s.late}</Badge>}
                  </span>
                  <span>{a.avg == null ? "—" : humanDuration(a.avg)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="bg-[var(--color-surface-2)] px-[22px] py-2.5 text-[11.5px] text-[var(--color-faint)]">
          {s.supNote}
        </div>
      </Card>
    </div>
  );
}

export function SupportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} pad="px-5 py-[18px]">
            <Skel className="h-[11px] w-24" />
            <Skel className="mt-2 h-[32px] w-16" />
            <Skel className="mt-2 h-[11px] w-28" />
          </Card>
        ))}
      </div>
      <Card>
        <div className="skeleton h-[220px] rounded-[10px]" />
      </Card>
      <Card>
        <div className="skeleton h-[260px] rounded-[10px]" />
      </Card>
    </div>
  );
}

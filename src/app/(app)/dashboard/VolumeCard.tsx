"use client";

import { useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { AreaChart } from "./charts";
import { Avatar, Card, EYEBROW, Empty } from "./ui";

function pctChange(now: number, prev: number) {
  return prev > 0 ? ((now - prev) / prev) * 100 : null;
}

function Delta({ pct, suffix = "%" }: { pct: number | null; suffix?: string }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`text-[11.5px] font-semibold ${up ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
      {up ? "↗" : "↘"} {Math.abs(pct).toFixed(1)}
      {suffix}
    </span>
  );
}

/** Message volume: inbound vs replied per day, or messages sent per agent. */
export function VolumeCard({
  labels,
  inbound,
  outbound,
  totals,
  prev,
  rate,
  ratePts,
  agents,
}: {
  labels: string[];
  inbound: number[];
  outbound: number[];
  totals: { inbound: number; outbound: number };
  prev: { inbound: number; outbound: number };
  rate: number | null;
  ratePts: number | null;
  agents: { name: string; sent: number; photo: string | null }[];
}) {
  const { t } = useShell();
  const s = t.dash;
  const [view, setView] = useState<"vol" | "agent">("vol");
  const max = Math.max(1, ...agents.map((a) => a.sent));

  const figure = (label: string, line: string, value: string, delta: React.ReactNode) => (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
        <span className="h-[2px] w-3.5" style={{ background: line }} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[26px] font-medium tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">{value}</span>
        {delta}
      </div>
    </div>
  );

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className={EYEBROW}>{s.volume}</span>
        <div className="flex rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-[3px]">
          {(["vol", "agent"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              aria-pressed={view === k}
              className={`rounded-[6px] px-3 py-1 text-[12px] font-semibold transition-colors ${
                view === k
                  ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,24,16,0.1)]"
                  : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              }`}
            >
              {k === "vol" ? s.vVol : s.vAgent}
            </button>
          ))}
        </div>
      </div>

      {view === "vol" ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            {figure(s.inbound, "var(--color-accent)", totals.inbound.toLocaleString("en-MY"), <Delta pct={pctChange(totals.inbound, prev.inbound)} />)}
            {figure(s.replied, "var(--color-brand-bright)", totals.outbound.toLocaleString("en-MY"), <Delta pct={pctChange(totals.outbound, prev.outbound)} />)}
            {figure(s.rate, "var(--color-border-strong)", rate == null ? "—" : `${rate.toFixed(1)}%`, <Delta pct={ratePts} suffix={` ${s.pts}`} />)}
          </div>
          <div className="mt-4">
            <AreaChart
              id="vol"
              labels={labels}
              series={[
                { name: s.inbound, color: "var(--color-accent)", points: inbound },
                { name: s.replied, color: "var(--color-brand-bright)", points: outbound, dashed: true },
              ]}
            />
          </div>
        </>
      ) : agents.length === 0 ? (
        <Empty>{s.noAgentMsgs}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {agents.map((a) => (
            <li key={a.name} className="flex items-center gap-3">
              <Avatar name={a.name} photo={a.photo} size={26} />
              <span className="w-40 shrink-0 truncate text-[12.5px] text-[var(--color-ink)]">{a.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[#4fb0c6]"
                  style={{ width: `${(a.sent / max) * 100}%` }}
                />
              </div>
              <span className="w-12 text-right text-[12.5px] tabular-nums text-[var(--color-muted)]">{a.sent}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

"use client";

/*
  Presentational atoms shared by the dashboard's client tab shell and by the
  server components that stream into it. They live in their own client module
  so a server section can render `<Card>` / `<BarRow>` without pulling in the
  whole tab shell.
*/

/** "live" / "demo" / "derived" provenance badge. */
export function Pill({ kind }: { kind: "real" | "demo" | "derived" }) {
  const map = {
    real: { t: "live", c: "var(--color-success)" },
    demo: { t: "demo", c: "var(--color-warning)" },
    derived: { t: "derived", c: "var(--color-faint)" },
  } as const;
  const { t, c } = map[kind];
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}
    >
      {t}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-[12px] font-medium text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight text-[var(--color-ink)]">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{hint}</div>}
    </div>
  );
}

export function Card({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</h3>
        {meta}
      </div>
      {children}
    </div>
  );
}

/** Horizontal proportion bar row (spend, funnel, tags). */
export function BarRow({
  label,
  value,
  pct,
  color = "var(--color-accent)",
}: {
  label: string;
  value: string;
  pct: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[12px] text-[var(--color-muted)]">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[12px] text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

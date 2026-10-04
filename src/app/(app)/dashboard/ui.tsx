/*
  Presentational atoms for the dashboard, in the redesign's card language:
  16px cards on white with a subtle border, 11px uppercase eyebrows, 20–34px
  tabular figures. Server-safe (no hooks), so streamed sections render them.
*/

import { initials, tint } from "@/lib/format";

export const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]";

export function Card({
  children,
  className = "",
  pad = "px-[22px] py-5",
}: {
  children: React.ReactNode;
  className?: string;
  pad?: string;
}) {
  return (
    <section className={`rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] ${pad} ${className}`}>
      {children}
    </section>
  );
}

/** Eyebrow title, optional sub-line and right-hand action. */
export function CardHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className={EYEBROW}>{title}</div>
        {sub && <div className="mt-1 text-[12px] text-[var(--color-faint)]">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/**
 * "↗ 1.0 pts" / "↘ 38s" chip on the headline cards — white, petrol text, as in
 * the design. The arrow carries the direction.
 */
export function DeltaChip({ text, up }: { text: string; up: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/85 px-2 py-px text-[11.5px] font-semibold text-[var(--color-accent-ink)] shadow-[0_1px_2px_rgba(17,24,16,0.06)]">
      {up ? "↗" : "↘"} {text}
    </span>
  );
}

/** Plain coloured delta for inline figures ("↘ 1.8%"). */
export function DeltaText({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct == null) return null;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span className={`text-[11.5px] font-semibold ${good ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
      {up ? "↗" : "↘"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: tint(name), width: size, height: size, fontSize: size >= 28 ? 9.5 : 8.5 }}
    >
      {initials(name).toUpperCase()}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[12.5px] text-[var(--color-faint)]">{children}</p>;
}

export function Badge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "primary" | "neutral";
  children: React.ReactNode;
}) {
  const cls = {
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    primary: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
    neutral: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  }[tone];
  return (
    <span className={`whitespace-nowrap rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}>
      {children}
    </span>
  );
}

import type { Dict } from "@/lib/i18n/dict";
import type { NavKey } from "./shell/nav";
import { TopbarSkeleton } from "./shell/TopbarSkeleton";

/*
  Skeleton primitives.

  These are the building blocks every `loading.tsx` uses. Two rules keep the
  loading states honest:

  1. A skeleton mirrors the real component's box model — same padding, same
     border, same font-derived heights — so nothing shifts when data arrives.
     Where the real markup is static (table headers, tab labels, empty-state
     copy), the skeleton renders the *real* markup rather than a grey bar.
  2. Everything is synchronous. `loading.tsx` is a Suspense fallback and must
     never suspend, so nothing here awaits.
*/

/** A single shimmering placeholder block. See `.skeleton` in globals.css. */
export function Skel({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/**
 * Sync stand-in for `PageChrome` — the same column of header + scrollable
 * main, so a route's chrome is on screen the instant the link is clicked.
 */
export function PageSkeleton({
  section,
  page,
  children,
}: {
  section: NavKey;
  page?: keyof Dict["page"];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopbarSkeleton section={section} page={page} />
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

/**
 * KPI tile placeholder, dimensioned off `Stat` in the dashboard:
 * 12px label · 26px value · 11px hint inside `p-4`.
 */
export function StatTileSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <Skel className="h-[14px] w-20" />
      <Skel className="mt-1 h-[31px] w-16" />
      <Skel className="mt-0.5 h-[13px] w-14" />
    </div>
  );
}

/**
 * Table placeholder. Column headers are real text (they never change), so the
 * table's identity is legible immediately and only the cells shimmer.
 * `widths` sets the placeholder width per column, in order.
 */
export function TableSkeleton({
  headers,
  widths,
  rows = 8,
  firstColAvatar = false,
  minWidth,
  dense = false,
}: {
  headers: string[];
  widths: string[];
  rows?: number;
  /** Render an avatar circle before the first cell's bar (contacts, payments). */
  firstColAvatar?: boolean;
  /** e.g. "min-w-[720px]" when the real table scrolls horizontally. */
  minWidth?: string;
  /** `py-2.5` cells, matching the settings org-chart table. */
  dense?: boolean;
}) {
  const cell = dense ? "px-4 py-2.5" : "px-4 py-3";
  return (
    <table className={`w-full text-left text-[13px] ${minWidth ?? ""}`}>
      <thead>
        <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
          {headers.map((h) => (
            <th key={h} className={`${cell} font-medium`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="skeleton-stagger">
        {Array.from({ length: rows }, (_, r) => (
          <tr
            key={r}
            className="border-b border-[var(--color-border)] last:border-0"
            style={{ "--i": r } as React.CSSProperties}
          >
            {headers.map((h, c) => (
              <td key={h} className={cell}>
                {c === 0 && firstColAvatar ? (
                  <div className="flex items-center gap-2.5">
                    <Skel className="h-7 w-7 shrink-0 rounded-full" />
                    <Skel className={`h-[14px] ${widths[c] ?? "w-24"}`} />
                  </div>
                ) : (
                  <Skel className={`h-[14px] ${widths[c] ?? "w-16"}`} />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Card placeholder matching the dashboard `Card` (title row + body slot). */
export function CardSkeleton({
  titleWidth = "w-32",
  children,
}: {
  titleWidth?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Skel className={`h-[15px] ${titleWidth}`} />
      </div>
      {children}
    </div>
  );
}

/** A `label ── bar ── value` row, matching the dashboard `BarRow`. */
export function BarRowSkeleton({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <Skel className="h-[13px] w-28 shrink-0" />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="skeleton h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <Skel className="h-[13px] w-10 shrink-0" />
    </div>
  );
}

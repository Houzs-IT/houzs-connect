"use client";

// How long the customer has been waiting for a reply, counted live.
//
// This is the number the team actually triages on: with no reply yet, the only
// question about a row is how long it has been sitting there. A relative "2h"
// is too coarse to sort a morning's backlog by, and it is also stale the moment
// the server rendered it — so the badge ticks in the browser.
//
// Colour follows the redesign: amber while under SLA_MINUTES, red past it.

import { useEffect, useState } from "react";
import { SLA_MINUTES } from "@/lib/sla";

// One interval for the whole rail. A busy inbox can show this badge on dozens
// of rows at once, and dozens of independent per-second timers is real work for
// a number that changes in lockstep anyway.
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!ticker) {
    ticker = setInterval(() => {
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

/** Elapsed time is an absolute difference, so no timezone is involved here. */
function waited(since: Date): { label: string; overdue: boolean } {
  const total = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    label: h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s)}s`,
    overdue: total >= SLA_MINUTES * 60,
  };
}

/** True once a wait has passed the SLA — for filtering, not rendering. */
export function isOverdue(since: string | null, now: number): boolean {
  return !!since && now - new Date(since).getTime() >= SLA_MINUTES * 60_000;
}

export function SlaTimer({ since, compact = false }: { since: string; compact?: boolean }) {
  // The first value comes from the initialiser, so the effect only subscribes.
  const [state, setState] = useState(() => waited(new Date(since)));

  useEffect(() => {
    const at = new Date(since);
    return subscribe(() => setState(waited(at)));
  }, [since]);

  const tone = state.overdue
    ? "border-[rgba(178,58,58,0.35)] bg-[rgba(178,58,58,0.1)] text-[var(--color-danger)]"
    : "border-[rgba(110,77,18,0.35)] bg-[rgba(110,77,18,0.1)] text-[var(--color-warning)]";

  const title = "Waiting on us — time since the customer's last message.";

  if (compact) {
    return (
      <span
        suppressHydrationWarning
        title={title}
        className={`flex shrink-0 items-center gap-[3px] font-semibold tabular-nums ${
          state.overdue ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"
        }`}
      >
        <span className="h-[5px] w-[5px] rounded-full bg-current" />
        {state.label}
      </span>
    );
  }

  return (
    <span
      // Server and browser read their clocks a moment apart, so the seconds
      // legitimately differ for the first paint.
      suppressHydrationWarning
      title={title}
      className={`flex shrink-0 items-center gap-[3px] whitespace-nowrap rounded-[4px] border px-1.5 py-px text-[10px] font-semibold tabular-nums ${tone}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {state.label}
    </span>
  );
}

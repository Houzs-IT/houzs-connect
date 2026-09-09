"use client";

// How long the customer has been waiting for a reply, counted in seconds.
//
// This is the number the team actually triages on: with no reply yet, the only
// question about a row is how long it has been sitting there. A relative "2h"
// is too coarse to sort a morning's backlog by, and it is also stale the moment
// the server rendered it — so the badge ticks in the browser.

import { useEffect, useState } from "react";

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
function waited(since: Date): string {
  const total = Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${m}m ${s}s`;
}

export function SlaTimer({ since }: { since: string }) {
  // The first value comes from the initialiser, so the effect only subscribes.
  const [label, setLabel] = useState(() => waited(new Date(since)));

  useEffect(() => {
    const at = new Date(since);
    return subscribe(() => setLabel(waited(at)));
  }, [since]);

  return (
    <span
      // Server and browser read their clocks a moment apart, so the seconds
      // legitimately differ for the first paint.
      suppressHydrationWarning
      title="Waiting on us — time since the customer's last message."
      className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] text-[var(--color-warning)]"
    >
      {label}
    </span>
  );
}

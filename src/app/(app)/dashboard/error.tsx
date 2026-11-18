"use client";

import { useEffect } from "react";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * Error boundary for the Dashboard segment. The page streams each card behind
 * its own <Suspense> but had no error boundary of its own, so a single card
 * that throws during render (e.g. a query that fails) fell all the way to
 * Next's default full-screen 500 — taking the whole tab, header and shell with
 * it. That is exactly how the Support tab went dark when `resolutionStats`
 * threw (PR #205).
 *
 * This boundary catches the throw and shows a retriable card INSIDE the (app)
 * layout: the sidebar, company switcher and nav stay put, and `reset()` re-runs
 * the segment so a transient failure clears without a full reload. It renders
 * under <ShellProvider> ((app)/layout wraps {children}), so useShell() is safe.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useShell();
  const s = t.dash;

  useEffect(() => {
    // Surface it for the browser console / error reporting; `digest` is the id
    // Next logs the real server-side stack under.
    console.error("Dashboard render failed:", error);
  }, [error]);

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-[420px] flex-col items-center gap-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-10 text-center shadow-[var(--shadow-card)]">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-danger-soft)] text-[var(--color-danger)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[16px] font-semibold text-[var(--color-ink)]">{s.errTitle}</h2>
          <p className="text-[13px] leading-[1.55] text-[var(--color-muted)]">{s.errBody}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex h-[38px] items-center rounded-[8px] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
          >
            {s.errRetry}
          </button>
          <a
            href="/dashboard"
            className="flex h-[38px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            {s.errHome}
          </a>
        </div>
        {error.digest && (
          <p className="mt-1 font-mono text-[10.5px] text-[var(--color-faint)]">
            {s.errRef}: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}

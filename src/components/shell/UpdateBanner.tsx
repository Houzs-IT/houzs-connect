"use client";

import { useEffect, useRef, useState } from "react";
import { BUILD_ID } from "@/lib/build-id";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * "A newer version is ready" — a non-blocking pill with a Refresh button, the
 * Connect twin of the ERP's NewVersionBanner.
 *
 * How it detects a new deploy: every build stamps a unique NEXT_PUBLIC_BUILD_ID
 * (next.config.ts) into both this bundle and the /api/version handler. This tab
 * booted with one id (BUILD_ID); it polls /api/version for the id of the server
 * answering right now, and a difference means a newer build is live. The poll
 * runs every 60s and again whenever the tab is brought back to the foreground.
 *
 * It never reloads on its own — a deploy that lands mid-typing must not wipe a
 * drafted reply. The operator clicks Refresh when ready. Under `next dev` there
 * is no build stamp (BUILD_ID === "dev"), so the check skips itself.
 *
 * Mounted once in the (app) shell, beside the other pollers.
 */
export function UpdateBanner() {
  const { t } = useShell();
  const s = t.shell;
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);
  // updateReady must not re-arm the effect each time it flips, or the 60s timer
  // would be torn down and rebuilt; read it through a ref instead.
  const ready = useRef(false);

  useEffect(() => {
    if (BUILD_ID === "dev") return; // dev server — nothing to compare against

    let stopped = false;
    const check = async () => {
      if (stopped || ready.current || document.hidden) return;
      try {
        const res = await fetch(`/api/version?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return; // transient / offline — try again next tick
        const { buildId } = (await res.json()) as { buildId?: string };
        if (buildId && buildId !== "dev" && buildId !== BUILD_ID) {
          ready.current = true;
          stopped = true;
          setUpdateReady(true);
        }
      } catch {
        /* network blip — ignore, the next tick retries */
      }
    };

    const timer = window.setInterval(() => void check(), 60_000);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check(); // once on mount

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+74px)] left-1/2 z-[100] flex w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[var(--color-ink)] px-4 py-2.5 text-[12.5px] text-white shadow-[var(--shadow-popover)] sm:w-auto sm:rounded-full sm:pl-[18px] sm:pr-3 md:bottom-6"
    >
      {/* breathing accent dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
      </span>
      <span className="min-w-0 leading-snug">
        {s.updateReady}
        <span className="ml-1.5 text-[var(--color-faint)]">· {s.updateHint}</span>
      </span>
      <button
        type="button"
        onClick={() => {
          setReloading(true);
          window.location.reload();
        }}
        disabled={reloading}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-[var(--color-accent-hi)] disabled:opacity-80"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={reloading ? "animate-spin" : ""}
        >
          <path d="M23 4v6h-6" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        {reloading ? s.updateRefreshing : s.updateRefresh}
      </button>
    </div>
  );
}

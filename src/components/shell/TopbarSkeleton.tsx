"use client";

import type { Dict } from "@/lib/i18n/dict";
import type { NavKey } from "./nav";
import { useShell } from "./ShellProvider";
import { LangToggle, MenuExpandButton } from "./TopbarControls";

// Local copy of `Skel` — importing it from ../skeleton would make the two
// modules import each other.
function Skel({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/**
 * Sync stand-in for `Topbar`. The breadcrumbs of a route are known before its
 * data is, so they render for real (translated from the shell context — a
 * `loading.tsx` must never suspend, so it cannot read cookies itself). Only the
 * signed-in member's chip is placeholder.
 */
export function TopbarSkeleton({
  section,
  page,
}: {
  section: NavKey;
  page?: keyof Dict["page"];
}) {
  const { t } = useShell();
  const crumbs = [t.nav[section], ...(page ? [t.page[page]] : [])];
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <MenuExpandButton />
      <h1 className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-ink)] md:hidden">
        {crumbs[crumbs.length - 1]}
      </h1>
      <div className="hidden items-center gap-2 text-[13px] md:flex">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-[var(--color-border-strong)]">/</span>}
            <span
              className={
                i === crumbs.length - 1
                  ? "font-semibold text-[var(--color-ink)]"
                  : "text-[var(--color-muted)]"
              }
            >
              {c}
            </span>
          </span>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <LangToggle className="hidden md:flex" />
        <div className="flex items-center gap-2 py-1 pl-1 pr-1.5">
          <Skel className="h-8 w-8 rounded-full" />
          <div className="hidden leading-tight sm:block">
            <Skel className="h-[13px] w-24" />
            <Skel className="mt-1 h-[11px] w-16" />
          </div>
        </div>
      </div>
    </header>
  );
}

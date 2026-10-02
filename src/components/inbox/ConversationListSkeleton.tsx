"use client";

import { Skel } from "@/components/skeleton";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * Placeholder for `ConversationList` while the inbox layout loads its
 * conversations. Same 320px rail, same search row and All / Department / SLA
 * tabs (static, so they render for real), same 36px avatar row geometry — the
 * list fills in underneath without moving anything.
 */
export function ConversationListSkeleton() {
  const { t } = useShell();
  const s = t.service;
  return (
    <div className="flex w-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:w-[320px]">
      <div className="flex gap-1.5 px-3 pt-3">
        <Skel className="skeleton-strong h-[34px] flex-1 rounded-[8px]" />
        <Skel className="hidden h-[34px] w-[34px] rounded-[8px] md:block" />
        <Skel className="h-[34px] w-[34px] rounded-[8px]" />
      </div>
      <div className="flex items-end gap-4 border-b border-[var(--color-border)] px-3.5 pt-2.5">
        {[s.tabAll, s.tabDept, s.tabSla].map((label, i) => (
          <span
            key={label}
            className={`-mb-px border-b-2 pb-[9px] pt-1.5 text-[12.5px] font-semibold ${
              i === 0 ? "border-[var(--color-accent)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-faint)]"
            }`}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="skeleton-stagger min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex gap-2.5 border-b border-[var(--color-border-subtle)] px-3.5 py-[11px]"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <Skel className="h-[15px] w-28" />
                <Skel className="h-[12px] w-10 shrink-0" />
              </div>
              <Skel className="mt-1 h-[14px] w-full" />
              <Skel className="mt-2 h-[17px] w-32 rounded-[6px]" />
              <div className="mt-1.5 flex items-center gap-1">
                <Skel className="h-[16px] w-14 rounded" />
                <Skel className="h-[16px] w-10 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

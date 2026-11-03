"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";

/** Period selector — writes ?period= (7 / 30 / 90 days) and re-renders. */
export function PeriodPicker({ value, range }: { value: number; range: string }) {
  const { t } = useShell();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
      {t.dash.period}
      <SearchableSelect
        aria-label={t.dash.period}
        value={String(value)}
        onChange={(v) => {
          const next = new URLSearchParams(params.toString());
          next.set("period", v);
          router.push(`${path}?${next.toString()}`, { scroll: false });
        }}
        options={Object.entries(t.dash.periods).map(([k, label]) => ({ value: k, label }))}
        className="relative flex h-[34px] cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-3 pr-2 text-[var(--color-ink)]"
        triggerContent={
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-faint)" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span className="whitespace-nowrap">{range}</span>
            <span className="text-[10px] text-[var(--color-faint)]">▾</span>
          </>
        }
      />
    </label>
  );
}

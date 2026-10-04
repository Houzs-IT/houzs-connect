"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { IconCheck, IconChevronDown } from "@/components/icons";

/**
 * A filter chip that opens a short option list and writes one query param
 * (`?category=UTILITY`). The empty option clears it. Other params are kept.
 */
export function FilterPill({
  param,
  label,
  anyLabel,
  options,
}: {
  param: string;
  label: string;
  anyLabel: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const current = params.get(param) ?? "";
  const currentLabel = options.find((o) => o.value === current)?.label;

  const pick = (v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(param, v);
    else p.delete(param);
    setOpen(false);
    router.push(`${path}${p.size ? `?${p}` : ""}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${
          current
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-border-strong)]"
        }`}
      >
        {currentLabel ? `${label}: ${currentLabel}` : label}
        <IconChevronDown width={12} height={12} className="text-[var(--color-faint)]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1 max-h-[300px] min-w-[180px] overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
            {[{ value: "", label: anyLabel }, ...options].map((o) => (
              <button
                key={o.value || "_any"}
                type="button"
                onClick={() => pick(o.value)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {o.label}
                {o.value === current && <IconCheck width={13} height={13} className="text-[var(--color-accent)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

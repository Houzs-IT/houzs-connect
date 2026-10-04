"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Department picker for the agents report — writes ?dept= and re-renders. */
export function DeptFilter({
  depts,
  value,
  allLabel,
}: {
  depts: { id: string; name: string }[];
  value: string;
  allLabel: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("dept", e.target.value);
        else next.delete("dept");
        router.push(`${path}?${next.toString()}`, { scroll: false });
      }}
      aria-label={allLabel}
      className="ml-auto h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] font-semibold text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
    >
      <option value="">{allLabel}</option>
      {depts.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

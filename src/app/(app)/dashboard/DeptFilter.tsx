"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchableSelect } from "@/components/SearchableSelect";

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
    <div className="ml-auto">
      <SearchableSelect
        value={value}
        onChange={(v) => {
          const next = new URLSearchParams(params.toString());
          if (v) next.set("dept", v);
          else next.delete("dept");
          router.push(`${path}?${next.toString()}`, { scroll: false });
        }}
        aria-label={allLabel}
        className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] font-semibold text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        options={[
          { value: "", label: allLabel },
          ...depts.map((d) => ({ value: d.id, label: d.name })),
        ]}
      />
    </div>
  );
}

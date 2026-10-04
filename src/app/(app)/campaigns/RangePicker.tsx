"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

/** "2 Sep – 2 Oct 2026" from two yyyy-mm-dd strings. */
function rangeLabel(from: string, to: string, any: string): string {
  const d = (s: string, year: boolean) =>
    new Date(`${s}T12:00:00+08:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "Asia/Kuala_Lumpur",
    }).replace("Sept", "Sep");
  if (from && to) return `${d(from, false)} – ${d(to, true)}`;
  if (from) return `${d(from, true)} –`;
  if (to) return `– ${d(to, true)}`;
  return any;
}

/** The date-range pill beside the search box; writes `?from=` / `?to=`. */
export function RangePicker({ from, to }: { from: string; to: string }) {
  const { t } = useShell();
  const L = t.camp;
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [tt, setT] = useState(to);

  const go = (nf: string, nt: string) => {
    const p = new URLSearchParams(params.toString());
    if (nf) p.set("from", nf);
    else p.delete("from");
    if (nt) p.set("to", nt);
    else p.delete("to");
    setOpen(false);
    router.push(`${path}${p.size ? `?${p}` : ""}`);
  };

  const input =
    "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[36px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] hover:border-[var(--color-border-strong)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--color-faint)]" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {rangeLabel(from, to, L.anyDate)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1 w-64 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-popover)]">
            <label className="mb-1 block text-[11px] text-[var(--color-muted)]">{L.from}</label>
            <input type="date" value={f} onChange={(e) => setF(e.target.value)} className={`${input} mb-2`} />
            <label className="mb-1 block text-[11px] text-[var(--color-muted)]">{L.to}</label>
            <input type="date" value={tt} onChange={(e) => setT(e.target.value)} className={input} />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setF("");
                  setT("");
                  go("", "");
                }}
                className="h-[30px] rounded-[8px] px-2.5 text-[12.5px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                {L.clear}
              </button>
              <button
                type="button"
                onClick={() => go(f, tt)}
                className="h-[30px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white"
              >
                {L.apply}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

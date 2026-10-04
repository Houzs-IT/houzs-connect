"use client";

import { useState } from "react";

/**
 * A full-strength primary button for a feature that is designed but not built.
 * It looks as the design draws it; pressing it says plainly that it is coming
 * rather than doing nothing.
 */
export function SoonButton({ label, note }: { label: string; note: string }) {
  const [said, setSaid] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-disabled
        onClick={() => setSaid(true)}
        className="mt-3 h-9 w-full rounded-[8px] bg-[var(--color-accent)] text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-[var(--color-accent-hi)]"
      >
        {label}
      </button>
      {said && <p className="mt-2 text-center text-[11.5px] text-[var(--color-faint)]">{note}</p>}
    </>
  );
}

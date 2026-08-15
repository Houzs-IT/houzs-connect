"use client";

import { useState } from "react";

/**
 * Copy a value to the clipboard — Seampify has this next to the phone number,
 * and an agent reading a number off the screen to paste into the ERP is exactly
 * where a digit goes missing.
 *
 * Falls back silently when the Clipboard API is unavailable (older browsers, or
 * a page not served over HTTPS); the label just never changes to "Copied".
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      title={done ? "Copied" : `Copy ${label}`}
      aria-label={done ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // No clipboard permission — leave the label alone rather than claim
          // a copy that did not happen.
        }
      }}
      className="rounded px-1 text-[11px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

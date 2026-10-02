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
export function CopyButton({
  value,
  label,
  doneLabel = "Copied",
}: {
  value: string;
  label: string;
  doneLabel?: string;
}) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      title={done ? doneLabel : label}
      aria-label={done ? doneLabel : label}
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
      className="shrink-0 text-[11px] font-medium text-[var(--color-accent)] hover:underline"
    >
      {done ? doneLabel : label}
    </button>
  );
}

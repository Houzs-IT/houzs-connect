"use client";

import { useEffect, useRef, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * "Invite person": Connect has no invite emails — people ask for access on the
 * sign-in page and are approved under Access requests. This hands out that
 * link, ready to paste into WhatsApp or email.
 */
export function InvitePerson() {
  const { t } = useShell();
  const L = t.set;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const link = typeof window === "undefined" ? "/login?request=1" : `${window.location.origin}/login?request=1`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
      >
        + {L.invite}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[320px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-[var(--shadow-popover)]">
          <p className="text-[12.5px] leading-snug text-[var(--color-muted)]">{L.inviteBody}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-[12px] text-[var(--color-ink)] outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className="h-[34px] shrink-0 rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              {copied ? L.inviteCopied : L.inviteCopy}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

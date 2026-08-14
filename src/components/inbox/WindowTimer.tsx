"use client";

// The real 24-hour customer-service window, counted down live.
//
// This was the string "23h 49m window", hardcoded, on every conversation. The
// number it fakes is the one that decides whether an agent may type a free-form
// reply at all: inside the window WhatsApp allows anything, outside it Meta
// rejects everything that is not an approved template. An operator reading a
// comfortable "23h 49m" on a conversation that actually closed hours ago will
// write a reply that silently never arrives.

import { useEffect, useState } from "react";

function remaining(expiresAt: Date | null): { label: string; open: boolean } {
  if (!expiresAt) return { label: "no window", open: false };
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return { label: "window closed", open: false };
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { label: h > 0 ? `${h}h ${m}m window` : `${m}m window`, open: true };
}

export function WindowTimer({ expiresAt }: { expiresAt: string | null }) {
  const parsed = expiresAt ? new Date(expiresAt) : null;
  const [state, setState] = useState(() => remaining(parsed));

  useEffect(() => {
    // A minute is the smallest unit shown, so there is nothing to gain from
    // ticking faster — but re-check often enough that "closed" lands promptly.
    // The initial value comes from useState's initialiser, so the effect only
    // subscribes; it does not set state synchronously on mount.
    const id = setInterval(() => setState(remaining(parsed)), 15_000);
    return () => clearInterval(id);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      title={
        state.open
          ? "Free-form replies are allowed until this expires. After that only an approved template can be sent."
          : "Outside the 24-hour window — only an approved template message can be sent to this customer."
      }
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
        state.open
          ? "border border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-success)]"
          : "border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]"
      }`}
    >
      {state.label}
    </span>
  );
}

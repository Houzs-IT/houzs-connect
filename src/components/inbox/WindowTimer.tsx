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
import { fmt, type Dict } from "@/lib/i18n/dict";
import { useShell } from "@/components/shell/ShellProvider";

type Left = { open: false; none: boolean } | { open: true; h: number; m: number };

function remaining(expiresAt: Date | null): Left {
  if (!expiresAt) return { open: false, none: true };
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return { open: false, none: false };
  const totalMinutes = Math.floor(ms / 60000);
  return { open: true, h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}

function label(left: Left, s: Dict["service"]): string {
  if (!left.open) return left.none ? s.noWindow : s.windowClosed;
  return left.h > 0 ? fmt(s.windowLeft, { h: left.h, m: left.m }) : fmt(s.windowLeftMin, { m: left.m });
}

/** `plain` drops the pill — the phone header shows it as a line of text. */
export function WindowTimer({ expiresAt, plain = false }: { expiresAt: string | null; plain?: boolean }) {
  const { t } = useShell();
  const s = t.service;
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

  const text = label(state, s);
  const title = state.open ? s.windowTip : s.windowClosedTip;

  if (plain) {
    return (
      <span
        suppressHydrationWarning
        title={title}
        className={`text-[11px] font-semibold ${state.open ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
      >
        {text}
      </span>
    );
  }

  return (
    <span
      suppressHydrationWarning
      title={title}
      className={`flex items-center gap-[5px] whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        state.open
          ? "border-[rgba(47,138,91,0.35)] bg-[rgba(47,138,91,0.1)] text-[var(--color-success)]"
          : "border-[rgba(178,58,58,0.35)] bg-[rgba(178,58,58,0.08)] text-[var(--color-danger)]"
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {text}
    </span>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { recentNotices } from "@/app/notify-actions";
import { clockTime } from "@/lib/format";
import type { Notice } from "@/lib/notifications";
import { IconBell } from "../icons";
import { useShell } from "./ShellProvider";

const SEEN_KEY = "hc.notices.seen";

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Top-bar bell: the last day of notices (new customer messages, SLA, mentions,
 * access requests). The red dot means something arrived since the list was
 * last opened in this browser.
 */
export function NotifyBell() {
  const { t } = useShell();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[] | null>(null);
  const [unseen, setUnseen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await recentNotices().catch(() => []);
      if (!alive) return;
      setItems(list);
      setUnseen(list.length > 0 && list[0].at > readSeen());
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    if (items?.[0]) {
      try {
        localStorage.setItem(SEEN_KEY, items[0].at);
      } catch {}
      setUnseen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={t.shell.notifications}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="relative grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        <IconBell width={16} height={16} />
        {unseen && (
          <span className="absolute right-[6px] top-[5px] h-[7px] w-[7px] rounded-full bg-[var(--color-danger)] ring-2 ring-[var(--color-surface)]" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-[320px] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
        >
          <div className="border-b border-[var(--color-border-subtle)] px-3.5 py-2.5 text-[12px] font-semibold text-[var(--color-ink)]">
            {t.shell.notifications}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {!items || items.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-[12.5px] text-[var(--color-faint)]">{t.shell.noNotices}</div>
            ) : (
              items.map((n, i) => (
                <Link
                  key={`${n.kind}-${n.href}-${i}`}
                  href={n.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block border-b border-[var(--color-border-subtle)] px-3.5 py-2.5 last:border-b-0 hover:bg-[var(--color-surface-2)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-[var(--color-ink)]">{n.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]">{clockTime(n.at)}</span>
                  </div>
                  {n.body && <div className="mt-0.5 truncate text-[12px] text-[var(--color-muted)]">{n.body}</div>}
                </Link>
              ))
            )}
          </div>
          <Link
            href="/settings/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
          >
            {t.shell.notifySettings}
          </Link>
        </div>
      )}
    </div>
  );
}

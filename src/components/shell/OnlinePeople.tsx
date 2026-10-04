"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { teamPresence, type PresenceMember, type TeamPresence } from "@/app/presence-actions";
import { fmt } from "@/lib/i18n/dict";
import { initials, tint } from "@/lib/format";
import { useShell } from "./ShellProvider";

/**
 * "Who's online", laid out as in the Houzs ERP (PresenceButton there) but drawn
 * in Connect's own style (6a "Ink Orbit": navy rail header, Plex Sans eyebrows,
 * soft badges, round tinted avatars): a people button with a green count,
 * opening Team activity — who is
 * active now (and on which page; a row takes you there) and who is away
 * (quiet 2–15 min). You are not in your own list. Current company only;
 * refreshed once a minute, the presence heartbeat's rhythm (lib/presence.ts).
 */

const SECTION: Record<string, string> = {
  inbox: "inbox",
  internal: "internal",
  dashboard: "dashboard",
  contacts: "contacts",
  automations: "automations",
  campaigns: "campaigns",
  templates: "templates",
  forms: "templates",
  payments: "payments",
  logs: "logs",
  settings: "settings",
};

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function OnlinePeople({ className = "" }: { className?: string }) {
  const { t } = useShell();
  const L = t.shell;
  const router = useRouter();
  const path = usePathname();
  const [data, setData] = useState<TeamPresence | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await teamPresence().catch(() => null);
      if (alive && res) setData(res);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Moving to another page (a row click, or anything else) closes the panel.
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setOpen(false);
  }

  const active = data?.active ?? [];
  const away = data?.away ?? [];
  const loading = data == null;

  const where = (m: PresenceMember) => {
    const key = SECTION[m.lastPath?.split("/")[1] ?? ""];
    return key ? t.nav[key as keyof typeof t.nav] : (t.role[m.role] ?? m.role);
  };
  const since = (m: PresenceMember) => {
    const mins = minutesSince(m.lastSeen);
    return mins <= 1 ? L.paNow : fmt(L.paMins, { n: mins });
  };
  const idle = (m: PresenceMember) => fmt(L.paIdle, { n: Math.max(minutesSince(m.lastSeen), 2) });
  const go = (m: PresenceMember) => {
    if (!m.lastPath) return;
    setOpen(false);
    router.push(m.lastPath);
  };

  // Connect's type: eyebrows 10–11px/600 caps (0.14em); badges 10px/600 caps (0.06em).
  const eyebrow = "text-[10.5px] font-semibold uppercase tracking-[0.14em]";
  const badge = "rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em]";

  return (
    <div ref={ref} className={`group relative shrink-0 ${className}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={fmt(L.paTip, { n: active.length })}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative grid h-[34px] w-[34px] place-items-center rounded-[8px] border transition-colors ${
          open
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {!loading && active.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[var(--color-success)] px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-[var(--color-surface)]">
            {active.length}
          </span>
        )}
      </button>

      {/* Hover tooltip — closed state only. */}
      {!open && (
        <span
          className="pointer-events-none absolute right-0 top-11 z-20 whitespace-nowrap rounded-[8px] bg-[var(--color-rail)] px-2.5 py-1.5 text-[11.5px] font-medium text-white opacity-0 shadow-[var(--shadow-popover)] transition-opacity delay-[400ms] group-hover:opacity-100"
        >
          {fmt(L.paTip, { n: active.length })}
        </span>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={L.paTitle}
          className="absolute right-0 top-11 z-40 w-[360px] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
        >
          <div className="flex items-center justify-between px-4 py-3.5" style={{ backgroundImage: "var(--rail-gradient)" }}>
            <span className={`text-white/85 ${eyebrow}`}>{L.paTitle}</span>
            <span className="flex items-center gap-1.5">
              <span className={`flex items-center gap-1.5 bg-[var(--color-success-soft)] text-[var(--color-success)] ${badge}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                {fmt(L.paOnline, { n: active.length })}
              </span>
              {away.length > 0 && (
                <span className={`flex items-center gap-1.5 bg-[var(--color-surface-2)] text-[var(--color-muted)] ${badge}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-faint)]" />
                  {fmt(L.paAway, { n: away.length })}
                </span>
              )}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-[8px] bg-[var(--color-surface-2)]" />
              ))}
            </div>
          ) : active.length === 0 && away.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--color-muted)]">{L.paEmpty}</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {active.length > 0 && (
                <>
                  <div className="px-4 pb-1.5 pt-3">
                    <span className={`bg-[var(--color-success-soft)] text-[var(--color-success)] ${badge}`}>{L.paActive}</span>
                  </div>
                  <div className="px-1.5 pb-1.5">
                    {active.map((m) => (
                      <div
                        key={m.id}
                        role={m.lastPath ? "button" : undefined}
                        tabIndex={m.lastPath ? 0 : undefined}
                        onClick={() => go(m)}
                        onKeyDown={(e) => e.key === "Enter" && go(m)}
                        className={`group/row flex items-center gap-3 rounded-[8px] px-2.5 py-2 ${
                          m.lastPath ? "cursor-pointer hover:bg-[var(--color-surface-2)]" : "cursor-default"
                        }`}
                      >
                        <span className="relative shrink-0">
                          <span
                            className="grid h-[30px] w-[30px] place-items-center rounded-full text-[10.5px] font-semibold text-white"
                            style={{ background: tint(m.name) }}
                          >
                            {initials(m.name).toUpperCase()}
                          </span>
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--color-success)] ring-2 ring-[var(--color-surface)]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{m.name}</span>
                          <span className="block truncate text-[11px] text-[var(--color-faint)]">{where(m)}</span>
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-success)]">
                          {m.lastPath ? (
                            <>
                              <span className="group-hover/row:hidden">{since(m)}</span>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="hidden group-hover/row:block">
                                <path d="M7 17 17 7M7 7h10v10" />
                              </svg>
                            </>
                          ) : (
                            since(m)
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {away.length > 0 && (
                <>
                  <div className="border-t border-[var(--color-border-subtle)] px-4 pb-1.5 pt-2.5">
                    <span className={`bg-[var(--color-surface-2)] text-[var(--color-muted)] ${badge}`}>{L.paAwayHead}</span>
                  </div>
                  <div className="px-1.5 pb-1.5">
                    {away.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 rounded-[8px] px-2.5 py-2 hover:bg-[var(--color-surface-2)]">
                        <span className="relative shrink-0">
                          <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[10.5px] font-semibold text-[var(--color-faint)]">
                            {initials(m.name).toUpperCase()}
                          </span>
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-faint)] bg-[var(--color-surface)]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[var(--color-muted)]">{m.name}</span>
                          <span className="block truncate text-[11px] text-[var(--color-faint)]">{where(m)}</span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]">{idle(m)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5">
            <span className="text-[11px] text-[var(--color-faint)]">{L.paRule}</span>
            <Link
              href="/settings/team"
              onClick={() => setOpen(false)}
              className="text-[11.5px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              {L.paManage} →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

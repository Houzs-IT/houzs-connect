"use client";

import { useEffect, useRef, useState } from "react";
import { teamPresence, type TeamPresence } from "@/app/presence-actions";
import { fmt } from "@/lib/i18n/dict";
import { agoLabel } from "@/lib/i18n/ago";
import { Avatar } from "./TopbarControls";
import { useShell } from "./ShellProvider";

/**
 * Who in this company is in Connect right now: a pill in the top bar (faces +
 * "6 online"), opening the list — online first, then everyone else with when
 * they were last seen. Refreshed once a minute, the same rhythm as the
 * presence heartbeat (lib/presence.ts), and scoped to the current company.
 */
export function OnlinePeople({ className = "" }: { className?: string }) {
  const { t } = useShell();
  const D = t.dash;
  const [people, setPeople] = useState<TeamPresence | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const list = await teamPresence().catch(() => null);
      if (alive && list) setPeople(list);
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

  if (!people) return null;
  const online = people.filter((p) => p.online);
  const offline = people.filter((p) => !p.online);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={D.onlineTip}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] pl-1.5 pr-3 text-[12px] transition-colors hover:bg-[var(--color-surface-2)]"
      >
        {online.length > 0 && (
          <span className="flex pl-1.5">
            {online.slice(0, 3).map((p) => (
              <span key={p.id} className="-ml-1.5 rounded-full border-2 border-[var(--color-surface)]">
                <Avatar name={p.name} size={20} />
              </span>
            ))}
          </span>
        )}
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        <b className="font-semibold text-[var(--color-ink)]">{fmt(D.online, { n: online.length })}</b>
        <span className="hidden text-[var(--color-faint)] xl:inline">· {fmt(D.offline, { n: offline.length })}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-[280px] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
        >
          <div className="max-h-[380px] overflow-y-auto py-1">
            <Group title={fmt(D.online, { n: online.length })} />
            {online.map((p) => (
              <Row key={p.id} name={p.name} me={p.me} meLabel={t.shell.you} dot="var(--color-success)" sub={t.shell.onlineNow} />
            ))}
            {offline.length > 0 && <Group title={fmt(D.offline, { n: offline.length })} />}
            {offline.map((p) => (
              <Row
                key={p.id}
                name={p.name}
                me={p.me}
                meLabel={t.shell.you}
                dot="var(--color-border-strong)"
                sub={p.lastSeen ? fmt(t.shell.lastSeen, { t: agoLabel(t, p.lastSeen) }) : t.shell.neverSeen}
              />
            ))}
          </div>
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3.5 py-2 text-[11px] text-[var(--color-faint)]">
            {D.onlineTip}
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title }: { title: string }) {
  return (
    <div className="px-3.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">{title}</div>
  );
}

function Row({ name, me, meLabel, dot, sub }: { name: string; me: boolean; meLabel: string; dot: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-1.5">
      <span className="relative shrink-0">
        <Avatar name={name} size={26} />
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface)]" style={{ background: dot }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-[var(--color-ink)]">
          {name}
          {me && <span className="ml-1 text-[11px] text-[var(--color-faint)]">({meLabel})</span>}
        </span>
        <span className="block truncate text-[11px] text-[var(--color-faint)]">{sub}</span>
      </span>
    </div>
  );
}

"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { setNotifyPref } from "@/app/notify-actions";
import type { NotifyKind, Prefs } from "@/lib/notifications";

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

const subscribe = () => () => {};
const permission = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

/** Per-kind switches, plus the browser's own permission. */
export function NotifyPrefs({ initial, kinds }: { initial: Prefs; kinds: readonly NotifyKind[] }) {
  const { t } = useShell();
  const L = t.set;
  const [prefs, setPrefs] = useState(initial);
  const [, start] = useTransition();
  const browserState = useSyncExternalStore(subscribe, permission, () => "default");
  const [asked, setAsked] = useState<string | null>(null);
  const state = asked ?? browserState;

  const set = (k: NotifyKind, ch: "browser" | "email", v: boolean) => {
    setPrefs((p) => ({ ...p, [k]: { ...p[k], [ch]: v } }));
    start(async () => {
      await setNotifyPref(k, ch, v);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-pastel-orange)] text-[14px] text-[var(--color-pastel-orange-ink)]">♪</span>
        <p className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
          {state === "granted" ? L.nAllowed : state === "denied" ? L.nBlocked : state === "unsupported" ? L.nUnsupported : L.nAllow}
        </p>
        {state === "default" && (
          <button
            type="button"
            onClick={() => void Notification.requestPermission().then((r) => setAsked(r))}
            className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)]"
          >
            {L.nAllow}
          </button>
        )}
      </section>

      <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="grid grid-cols-[1fr_90px_90px] border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">
          <span />
          <span className="text-center">{L.nBrowser}</span>
          <span className="text-center">{L.nEmail}</span>
        </div>
        {kinds.map((k) => (
          <div key={k} className="grid grid-cols-[1fr_90px_90px] items-center border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-0">
            <span className="text-[13.5px] text-[var(--color-ink)]">{L.nkinds[k]}</span>
            <span className="flex justify-center">
              <Toggle on={prefs[k].browser} onChange={(v) => set(k, "browser", v)} />
            </span>
            <span className="flex justify-center">
              <Toggle on={prefs[k].email} onChange={(v) => set(k, "email", v)} />
            </span>
          </div>
        ))}
      </section>
      <p className="text-[12px] text-[var(--color-faint)]">{L.nEmailOff}</p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { saveAutoAssign } from "./actions";

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

export function AutoAssignForm({
  enabled,
  canEdit,
  online,
  total,
  lastSaved,
}: {
  enabled: boolean;
  canEdit: boolean;
  online: number;
  total: number;
  lastSaved: { at: string; by: string | null } | null;
}) {
  const { t } = useShell();
  const L = t.set;
  const [on, setOn] = useState(enabled);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) => {
    if (!canEdit || pending) return;
    setOn(next);
    setResult(null);
    start(async () => {
      const r = await saveAutoAssign(next);
      if (r.ok) {
        setResult({ ok: true, text: L.arSaved });
      } else {
        setOn(!next); // roll back the switch if the save was refused
        setResult({ ok: false, text: r.error ?? "It could not be saved." });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px]"
            style={{ background: "var(--color-pastel-cyan)", color: "var(--color-pastel-cyan-ink)" }}
          >
            ⇥
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{L.aaTitle}</h3>
            <p className="text-[12px] text-[var(--color-faint)]">{L.aaCardSub}</p>
          </div>
          <Toggle on={on} onChange={toggle} disabled={!canEdit || pending} label={L.aaEnable} />
        </div>
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">{L.aaExplain}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {on ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-success-soft)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                {fmt(L.aaReady, { online, total })}
              </span>
            ) : (
              <span className="text-[12px] text-[var(--color-faint)]">{L.aaOff}</span>
            )}
          </div>
        </div>
      </section>

      {!canEdit && <p className="text-[12.5px] text-[var(--color-muted)]">{L.arOnlyAdmins}</p>}
      {canEdit && lastSaved && (
        <span className="text-[12px] text-[var(--color-faint)]">
          {fmt(L.arLast, {
            when: new Date(lastSaved.at)
              .toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })
              .replace("Sept", "Sep"),
            by: lastSaved.by ? ` · ${lastSaved.by}` : "",
          })}
        </span>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-[12.5px] ${result.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

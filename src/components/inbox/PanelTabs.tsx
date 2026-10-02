"use client";

import { useState } from "react";

/**
 * The right panel's segmented switch. The three bodies are rendered on the
 * server and handed in, so switching tabs is instant and fetches nothing.
 */
export function PanelTabs({
  tabs,
}: {
  tabs: { key: string; label: string; body: React.ReactNode }[];
}) {
  const [on, setOn] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === on) ?? tabs[0];
  return (
    <>
      <div className="mx-4 flex gap-0.5 rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-[3px]">
        {tabs.map((t) => {
          const active = t.key === current?.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setOn(t.key)}
              aria-pressed={active}
              className={`flex-1 rounded-[6px] py-[5px] text-center text-[12px] font-semibold transition-colors ${
                active
                  ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,24,16,0.08),0_0_0_1px_var(--color-border-subtle)]"
                  : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-5 pt-3.5">
        {current?.body}
      </div>
    </>
  );
}

/** Fields tab list with a "show empty" switch. */
export function FieldList({
  rows,
  filledLabel,
  showEmptyLabel,
  hideEmptyLabel,
}: {
  rows: { key: string; name: string; value: string }[];
  filledLabel: string;
  showEmptyLabel: string;
  hideEmptyLabel: string;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const shown = showEmpty ? rows : rows.filter((r) => r.value);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)]">
        <span>{filledLabel}</span>
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="font-medium text-[var(--color-accent)] hover:underline"
        >
          {showEmpty ? hideEmptyLabel : showEmptyLabel}
        </button>
      </div>
      {shown.length > 0 && (
        <div className="rounded-[10px] border border-[var(--color-border)]">
          {shown.map((r) => (
            <div
              key={r.key}
              className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-[12.5px] last:border-b-0"
            >
              <span className="truncate text-[var(--color-faint)]" title={r.name}>
                {r.name}
              </span>
              <span className={`break-words font-medium ${r.value ? "text-[var(--color-ink)]" : "text-[var(--color-border-strong)]"}`}>
                {r.value || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

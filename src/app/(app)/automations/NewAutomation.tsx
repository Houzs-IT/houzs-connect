"use client";

import { useState } from "react";
import { createAutomation } from "./actions";
import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";
import { IconClose } from "@/components/icons";

const FIELD =
  "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] font-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";

/** "New automation" in the Topbar: the create form, in a dialog. */
export function NewAutomation({
  triggers,
  canCreate,
}: {
  triggers: { value: string; label: string; hint: string }[];
  canCreate: boolean;
}) {
  const { t } = useShell();
  const L = t.autos;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">{L.newAutomation}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,16,32,0.45)] p-4" onClick={() => setOpen(false)}>
          <form
            action={createAutomation}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-[16px] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-[var(--color-ink)]">{L.newAutomation}</div>
                <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">{L.newHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.shell.close}
                className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                <IconClose width={16} height={16} />
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.colName}
                <input name="name" required placeholder="e.g. Delivery date confirmation" className={FIELD} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.colWhen}
                <SearchableSelect
                  name="triggerType"
                  defaultValue="NEW_INCOMING_MESSAGE"
                  className={FIELD}
                  aria-label={L.colWhen}
                  options={triggers.map((x) => ({ value: x.value, label: x.label }))}
                />
              </label>
              <ul className="flex flex-col gap-1">
                {triggers.map((x) => (
                  <li key={x.value} className="text-[11px] leading-snug text-[var(--color-faint)]">
                    <span className="text-[var(--color-muted)]">{x.label}</span> — {x.hint}
                  </li>
                ))}
              </ul>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.actionId}
                <input name="callbackId" placeholder="e.g. To Send Delivery Date" className={FIELD} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.note}
                <textarea
                  name="description"
                  rows={2}
                  className="resize-none rounded-[8px] border border-[var(--color-border)] p-2 text-[13px] font-normal outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              {!canCreate && <p className="text-[11.5px] text-[var(--color-danger)]">{L.noChannel}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {t.service.cancel}
              </button>
              <button
                type="submit"
                disabled={!canCreate}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-50"
              >
                {L.create}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

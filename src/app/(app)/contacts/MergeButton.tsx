"use client";

import { useState } from "react";
import { mergeContacts } from "./actions";

export interface MergeOption {
  id: string;
  label: string;
}

/**
 * Fold a duplicate into this contact.
 *
 * The row you click is the one that SURVIVES — its name, email and attributes
 * win, and the duplicate's conversations and history move onto it. That is the
 * opposite of what half the merge UIs in the world do, so the panel says it in
 * words rather than relying on the operator guessing right about an irreversible
 * action.
 */
export function MergeButton({
  keepId,
  keepLabel,
  options,
}: {
  keepId: string;
  keepLabel: string;
  options: MergeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Fold a duplicate contact into ${keepLabel}`}
        className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        Merge
      </button>
    );
  }

  return (
    <div
      role="presentation"
      onClick={() => !busy && setOpen(false)}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-ink)_38%,transparent)] p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Merge contacts"
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
      >
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">
            Merge a duplicate into {keepLabel}
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
            {keepLabel} is kept. The contact you pick disappears and its
            conversations, messages, payments and tags move across. This cannot be
            undone.
          </p>
        </div>

        <div className="px-5 py-4">
          <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Duplicate to fold in
          </label>
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">Choose a contact…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {error && (
            <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !pick}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const fd = new FormData();
              fd.set("keepId", keepId);
              fd.set("mergeId", pick);
              const res = await mergeContacts(fd);
              setBusy(false);
              if (res?.ok) {
                setOpen(false);
                setPick("");
                return;
              }
              setError(res?.error ?? "The merge did not go through.");
            }}
            className="rounded-lg bg-[var(--color-danger)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Merging…" : "Merge them"}
          </button>
        </div>
      </div>
    </div>
  );
}

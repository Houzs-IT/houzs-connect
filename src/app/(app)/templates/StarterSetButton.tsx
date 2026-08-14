"use client";

// One-click import of the delivery follow-up templates Houzs already runs on,
// submitted to Meta for review through the same server action the composer
// uses. Existing names are skipped, so it is safe to press twice.

import { useState, useTransition } from "react";
import { STARTER_LABELS } from "./starterLabels";
import { submitStarterSet, type StarterResult } from "./actions";

export function StarterSetButton() {
  const [results, setResults] = useState<StarterResult[] | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
        Import the delivery follow-up set
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Submits the {STARTER_LABELS.length} templates the delivery flow runs on, worded exactly as
        they are today. Already-submitted names are skipped.
      </p>

      <ul className="mt-3 space-y-1">
        {STARTER_LABELS.map((l) => (
          <li key={l.name} className="text-[11.5px] text-[var(--color-muted)]">
            · {l.label}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-[var(--color-faint)]">
        The two balance-collection templates are not included — they carry live bank account
        numbers, so create those in the composer and paste the account line there.
      </p>

      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResults(await submitStarterSet()))}
        className="mt-3 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
      >
        {pending ? "Submitting to Meta…" : "Submit all for review"}
      </button>

      {results && (
        <ul className="mt-3 space-y-1">
          {results.map((r) => (
            <li key={r.name} className="text-[11.5px]">
              <span className="font-mono text-[var(--color-ink)]">{r.name}</span>{" "}
              {r.ok ? (
                <span className="text-[var(--color-success)]">
                  {r.status === "ALREADY_EXISTS" ? "already there" : (r.status ?? "submitted")}
                </span>
              ) : (
                <span className="text-[var(--color-danger)]">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

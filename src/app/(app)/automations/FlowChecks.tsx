"use client";

import { useState } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import {
  APPROXIMATION_FOOTNOTE,
  SEVERITY_LABEL,
  type FlowGap,
} from "./copy";

/**
 * Expands the "Approximations: N" note the Seampify importer wrote into every
 * automation's description.
 *
 * The owner was being asked to review a number the UI never explained. This
 * lists, step type by step type, what does not do the real thing when the flow
 * runs — recomputed from the saved graph rather than read out of the frozen
 * description, so it stays true after he edits the flow.
 */

const SEVERITY_TONE: Record<FlowGap["severity"], string> = {
  stops: "var(--color-danger)",
  silent: "var(--color-warning)",
  partial: "var(--color-muted)",
};

export function FlowChecks({
  name,
  gaps,
  importApproximations,
  size = "sm",
}: {
  name: string;
  gaps: FlowGap[];
  /** the number frozen into `description` at import time, if any */
  importApproximations: number | null;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);

  const total = gaps.reduce((n, g) => n + g.count, 0);
  const stopCount = gaps
    .filter((g) => g.severity === "stops")
    .reduce((n, g) => n + g.count, 0);

  const pad = size === "md" ? "px-3 py-1.5 text-[12.5px]" : "px-2 py-1 text-[11.5px]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] ${pad} text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]`}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background:
              stopCount > 0 ? "var(--color-danger)" : "var(--color-warning)",
          }}
        />
        {total > 0
          ? `${total} step${total === 1 ? "" : "s"} need checking`
          : "What “approximations” means"}
      </button>

      <ActionDialog
        open={open}
        title={`What to check in “${name}”`}
        subtitle={
          importApproximations != null
            ? `The import marked ${importApproximations} approximations. Here is what is still visible in the flow.`
            : "Steps in this flow that do not do the real thing yet."
        }
        onClose={() => setOpen(false)}
        width="w-[560px]"
      >
        {gaps.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-muted)]">
            Nothing in this flow is a placeholder. Every step it contains does the
            real thing when it runs.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {gaps.map((g) => (
              <li
                key={g.key}
                className="rounded-lg border border-[var(--color-border)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">
                    {g.title}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                    style={{
                      background: `color-mix(in srgb, ${SEVERITY_TONE[g.severity]} 12%, transparent)`,
                      color: SEVERITY_TONE[g.severity],
                    }}
                  >
                    {SEVERITY_LABEL[g.severity]}
                  </span>
                  <span className="font-mono text-[10.5px] text-[var(--color-faint)]">
                    ×{g.count}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
                  {g.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
          {APPROXIMATION_FOOTNOTE}
        </p>
      </ActionDialog>
    </>
  );
}

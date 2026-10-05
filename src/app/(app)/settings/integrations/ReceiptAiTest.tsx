"use client";

import { useState, useTransition } from "react";
import type { ProbeResult } from "@/lib/receipt-vision";
import { testReceiptAi } from "./actions";

/**
 * "Test connection" for the receipt AI. Shows each step's answer as-is (status,
 * who answered, the start of the reply) so a failure can be read off the page
 * instead of from the Worker's logs.
 */
export function ReceiptAiTest({ labels }: { labels: { test: string; testing: string; ok: string; fail: string } }) {
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [pending, start] = useTransition();
  const allOk = !!result && result.steps.length > 0 && result.steps.every((s) => s.ok);

  return (
    <div className="mt-2.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await testReceiptAi()))}
        className="h-[30px] rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
      >
        {pending ? labels.testing : labels.test}
      </button>
      {result && (
        <div className="mt-2.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
          <p className={`text-[12.5px] font-semibold ${allOk ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {allOk ? labels.ok : labels.fail}
          </p>
          <ul className="mt-1.5 space-y-1 font-mono text-[11px] leading-[1.45] text-[var(--color-muted)]">
            {result.steps.map((s) => (
              <li key={s.step} className="break-all">
                <span className={s.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>{s.ok ? "✓" : "✕"}</span> {s.step} · {s.status ?? "-"} ·{" "}
                {s.from} · {s.detail}
              </li>
            ))}
            <li className="break-all">
              state={result.state} · key {result.key} · fetch={result.fetch}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

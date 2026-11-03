"use client";

// The drip builder: a vertical timeline of steps, each a delay + an approved
// template + a remove-after-reply toggle (Seampify's Drip Campaign builder).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { saveDrip, setDripStatus, deleteDrip } from "./actions";
import type { DripStepInput, DripTemplate, DripUnit } from "./spec";

const UNITS: DripUnit[] = ["minutes", "hours", "days"];

export function DripBuilder({
  id,
  initialName,
  initialSteps,
  live,
  enrolled,
  templates,
}: {
  id: string;
  initialName: string;
  initialSteps: DripStepInput[];
  live: boolean;
  enrolled: number;
  templates: DripTemplate[];
}) {
  const { t } = useShell();
  const L = t.drip;
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [steps, setSteps] = useState<DripStepInput[]>(initialSteps);
  const [isLive, setIsLive] = useState(live);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const input =
    "h-9 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)]";

  function patch(i: number, next: Partial<DripStepInput>) {
    setSteps((xs) => xs.map((s, j) => (j === i ? { ...s, ...next } : s)));
    setSaved(false);
  }
  function addStep() {
    setSteps((xs) => [
      ...xs,
      { afterUnit: "days", afterAmount: xs.length === 0 ? 0 : 1, templateName: "", templateLang: "", templateBody: "", removeAfterReplied: false },
    ]);
    setSaved(false);
  }
  function removeStep(i: number) {
    setSteps((xs) => xs.filter((_, j) => j !== i));
    setSaved(false);
  }
  function pickTemplate(i: number, templateName: string) {
    const tpl = templates.find((x) => x.name === templateName);
    patch(i, {
      templateName,
      templateLang: tpl?.language ?? "",
      templateBody: tpl?.body ?? "",
    });
  }

  async function save() {
    setBusy(true);
    const res = await saveDrip(id, name, steps);
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    }
  }
  async function toggleLive() {
    setBusy(true);
    const res = await setDripStatus(id, !isLive);
    setBusy(false);
    if (res.ok) {
      setIsLive(res.live);
      router.refresh();
    }
  }
  async function remove() {
    setBusy(true);
    await deleteDrip(id);
    router.push("/drip-campaigns");
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-1 text-[17px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <span className="shrink-0 text-[12px] text-[var(--color-faint)]">{fmt(L.enrolledN, { n: enrolled })}</span>
        <button
          onClick={toggleLive}
          disabled={busy}
          className={`h-[34px] shrink-0 rounded-[8px] px-3 text-[13px] font-semibold disabled:opacity-50 ${
            isLive
              ? "border border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              : "bg-[var(--color-success)] text-white hover:opacity-90"
          }`}
        >
          {isLive ? L.pause : L.goLive}
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="h-[34px] shrink-0 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-50"
        >
          {saved ? L.saved : L.save}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="h-[34px] shrink-0 rounded-[8px] px-2.5 text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
        >
          {L.delete}
        </button>
      </div>

      <div className="flex flex-col gap-3 p-5">
        {templates.length === 0 && (
          <p className="rounded-[10px] bg-[var(--color-warning-soft)] px-3 py-2 text-[12.5px] text-[var(--color-warning)]">{L.noTemplates}</p>
        )}

        {steps.map((s, i) => (
          <div key={i} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[var(--color-ink)]">{fmt(L.step, { n: i + 1 })}</span>
              <button onClick={() => removeStep(i)} className="text-[12px] text-[var(--color-danger)] hover:underline">
                {L.removeStep}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-[var(--color-muted)]">{L.after}</span>
              <input
                type="number"
                min={0}
                value={s.afterAmount}
                onChange={(e) => patch(i, { afterAmount: Number(e.target.value) })}
                className={`${input} w-20`}
              />
              <select value={s.afterUnit} onChange={(e) => patch(i, { afterUnit: e.target.value as DripUnit })} className={input}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {L[u]}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2.5">
              <label className="mb-1 block text-[12.5px] text-[var(--color-muted)]">{L.template}</label>
              <select value={s.templateName} onChange={(e) => pickTemplate(i, e.target.value)} className={`${input} w-full`}>
                <option value="">{L.chooseTemplate}</option>
                {templates.map((tpl) => (
                  <option key={`${tpl.name}:${tpl.language}`} value={tpl.name}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              {s.templateBody && (
                <p className="mt-1.5 whitespace-pre-wrap rounded-[8px] bg-[var(--color-surface-2)] px-2.5 py-2 text-[12px] text-[var(--color-muted)]">{s.templateBody}</p>
              )}
            </div>

            <label className="mt-2.5 flex items-center gap-2 text-[12.5px] text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={s.removeAfterReplied}
                onChange={(e) => patch(i, { removeAfterReplied: e.target.checked })}
              />
              {L.removeAfterReplied}
            </label>

            {i === 0 && <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{L.firstStepNote}</p>}
          </div>
        ))}

        <button
          onClick={addStep}
          className="self-start rounded-[8px] border border-dashed border-[var(--color-border-strong)] px-3 py-2 text-[13px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
        >
          + {L.addStep}
        </button>
      </div>
    </div>
  );
}

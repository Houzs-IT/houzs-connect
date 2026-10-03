"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { IconBolt, IconDots } from "@/components/icons";
import { fmt } from "@/lib/i18n/dict";
import { useShell } from "@/components/shell/ShellProvider";
import { type FlowGap } from "./copy";
import { FlowChecks } from "./FlowChecks";
import { PublishControl } from "./PublishControl";
import {
  deleteAutomation,
  duplicateAutomation,
  renameAutomation,
} from "./actions";

/**
 * One automation in the list, with every control the server already supported
 * but nothing on screen exposed: publish, unpublish, rename, duplicate, delete,
 * and an explanation of the "Approximations: N" note the importer left behind.
 *
 * Everything it receives is plain serialisable data — no callbacks are passed
 * down into rendered arrays, which is what the repo's `react-hooks/refs` rule
 * objects to. The dialogs are driven by one `mode` string and a switch, for the
 * same reason.
 */

export interface AutomationCardData {
  id: string;
  name: string;
  /** the part of `description` the owner wrote, import boilerplate stripped */
  note: string;
  imported: boolean;
  /** the number the Seampify importer froze into the description */
  importApproximations: number | null;
  channelName: string;
  triggerLabel: string;
  /** full sentence: "every time a customer sends a message to this number" */
  triggerSentence: string;
  enabled: boolean;
  version: number;
  nodeCount: number;
  edgeCount: number;
  runCount: number;
  updatedLabel: string;
  messageSteps: number;
  apiSteps: number;
  gaps: FlowGap[];
  /** Runs started per Malaysian day, oldest first (7 values). */
  daily: number[];
  runs7: number;
  /** The second line under the trigger: action id, tag, keyword… */
  triggerDetail: string | null;
}

type Mode = "none" | "delete" | "edit";

export function AutomationCard({ a }: { a: AutomationCardData }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("none");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(a.name);
  const [draftNote, setDraftNote] = useState(a.note);
  const [menu, setMenu] = useState(false);
  const { t } = useShell();
  const L = t.autos;
  // The "what needs checking" explainer opens from the yellow badge.
  const [showChecks, setShowChecks] = useState(false);

  const close = () => {
    setMode("none");
    setError(null);
  };

  // One dispatcher for every dialog's confirm button, so the card renders no
  // per-item callback objects.
  const run = (which: Mode) => {
    setError(null);
    startTransition(async () => {
      switch (which) {
        case "delete": {
          const res = await deleteAutomation(a.id);
          if (!res.ok) return setError("Could not delete this automation.");
          break;
        }
        case "edit": {
          const res = await renameAutomation(a.id, draftName, draftNote);
          if (!res.ok) return setError(res.error ?? "Could not save.");
          setFlash("Saved.");
          break;
        }
        default:
          break;
      }
      setMode("none");
      router.refresh();
    });
  };

  const duplicate = () => {
    setError(null);
    startTransition(async () => {
      const res = await duplicateAutomation(a.id);
      if (!res.ok) return setError("Could not copy this automation.");
      setFlash("Copied. The copy is a draft — find it at the top of this list.");
      router.refresh();
    });
  };

  const openEdit = () => {
    setDraftName(a.name);
    setDraftNote(a.note);
    setError(null);
    setMode("edit");
  };

  const gapCount = a.gaps.reduce((n, g) => n + g.count, 0);
  const stopCount = a.gaps
    .filter((g) => g.severity === "stops")
    .reduce((n, g) => n + g.count, 0);

  const max = Math.max(1, ...a.daily);
  const spark = a.daily
    .map((v, i) => `${(i / Math.max(1, a.daily.length - 1)) * 56},${18 - (v / max) * 16}`)
    .join(" ");

  return (
    <div className="relative grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_36px] items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5 last:border-b-0 hover:bg-[var(--color-surface-2)]">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
            a.enabled ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
          }`}
        >
          <IconBolt width={17} height={17} />
        </span>
        <div className="min-w-0">
          <Link href={`/automations/${a.id}`} className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)] hover:underline">
            {a.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
            {fmt(L.steps, { n: a.nodeCount })}
            {gapCount > 0 && (
              <button type="button" onClick={() => setShowChecks((v) => !v)} className="rounded-full bg-[var(--color-warning-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--color-warning)] hover:underline">
                {fmt(L.needAgent, { n: gapCount })}
              </button>
            )}
            {a.importApproximations != null && (
              <button type="button" onClick={() => setShowChecks((v) => !v)} className="rounded-full bg-[var(--color-warning-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--color-warning)] hover:underline">
                {fmt(L.imported, { n: a.importApproximations })}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[12.5px] text-[var(--color-ink)]">{L.triggers[a.triggerLabel] ?? a.triggerLabel}</div>
        <div className="truncate text-[11.5px] text-[var(--color-faint)]" title={a.triggerSentence}>
          {a.triggerDetail ?? a.channelName}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <svg width="56" height="20" viewBox="0 0 56 20" className="shrink-0" aria-hidden>
          <polyline points={spark} fill="none" stroke={a.runs7 ? "var(--color-accent)" : "var(--color-border-strong)"} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold tabular-nums text-[var(--color-ink)]">{a.runs7}</div>
          <div className="text-[10.5px] text-[var(--color-faint)]">{L.last7}</div>
        </div>
      </div>

      <div className="leading-tight">
        <div className="text-[12.5px] text-[var(--color-ink)]">{a.updatedLabel}</div>
        <div className="text-[10.5px] text-[var(--color-faint)]">v{a.version}</div>
      </div>

      <PublishControl
        size="toggle"
        liveLabel={L.live}
        draftLabel={L.draft}
        facts={{
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          triggerSentence: a.triggerSentence,
          messageSteps: a.messageSteps,
          apiSteps: a.apiSteps,
          gapCount,
          stopCount,
        }}
      />

      <div className="relative">
        <button
          type="button"
          aria-label="Actions"
          onClick={() => setMenu((v) => !v)}
          className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)]"
        >
          <IconDots width={15} height={15} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
              <Link href={`/automations/${a.id}`} className="block px-3 py-2 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
                {L.open}
              </Link>
              {[
                [L.rename, () => { setMenu(false); openEdit(); }],
                [L.duplicate, () => { setMenu(false); duplicate(); }],
                [L.delete, () => { setMenu(false); setMode("delete"); }],
              ].map(([label, fn]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={fn as () => void}
                  className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)] ${
                    label === L.delete ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"
                  }`}
                >
                  {label as string}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {(error || flash) && (
        <div className={`col-span-6 text-[11.5px] ${error ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"}`}>
          {error ?? flash}
        </div>
      )}
      {(a.gaps.length > 0 || a.importApproximations != null) && showChecks && (
        <div className="col-span-6">
          <FlowChecks name={a.name} gaps={a.gaps} importApproximations={a.importApproximations} />
        </div>
      )}

      {/* ── Delete ──────────────────────────────────────────────── */}
      <ActionConfirm
        open={mode === "delete"}
        title={`Delete “${a.name}”?`}
        confirmLabel="Delete it"
        busyLabel="Deleting…"
        busy={pending}
        danger
        onCancel={close}
        onConfirm={() => run("delete")}
      >
        <p className="text-[var(--color-ink)]">This cannot be undone.</p>
        <p className="mt-2">
          The flow, all {a.nodeCount} of its steps, its {a.runCount} recorded runs and
          its whole version history are removed. There is no restore.
        </p>
        {a.enabled && (
          <p className="mt-2 text-[var(--color-danger)]">
            This automation is live right now. Deleting it stops it {a.triggerSentence}.
          </p>
        )}
        <p className="mt-2">
          If you only want it to stop running, press Cancel and use “Switch off”
          instead.
        </p>
      </ActionConfirm>

      {/* ── Rename / note ───────────────────────────────────────── */}
      <ActionDialog
        open={mode === "edit"}
        title="Edit name and note"
        subtitle="Only the label — the flow itself is edited in the builder."
        onClose={close}
      >
        <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Name</label>
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        />
        <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
          Note (optional — what this flow is for)
        </label>
        <textarea
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          rows={3}
          className="mb-3 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
        />
        {a.imported && (
          <p className="mb-3 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-[11px] text-[var(--color-faint)]">
            The import note that used to sit here is not shown as text any more — it is
            explained under “steps need checking”. Saving an empty note is fine.
          </p>
        )}
        {error && (
          <p className="mb-3 text-[11.5px] text-[var(--color-danger)]">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => run("edit")}
            disabled={pending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </ActionDialog>

    </div>
  );
}

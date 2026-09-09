"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { IconBolt } from "@/components/icons";
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

  return (
    <div className="animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
      <div className="flex items-start gap-3 p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <IconBolt width={18} height={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/automations/${a.id}`}
              className="text-[14px] font-semibold text-[var(--color-ink)] hover:underline"
            >
              {a.name}
            </Link>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                a.enabled
                  ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
              }`}
            >
              {a.enabled ? "Live" : "Draft"}
            </span>
          </div>

          <p className="mt-1 text-[12px] text-[var(--color-muted)]">
            Runs {a.triggerSentence}.
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--color-faint)]">
            {a.channelName} · {a.enabled
              ? "customers receive its messages"
              : "switched off — no customer sees it"}
          </p>

          {a.note && (
            <p className="mt-2 text-[12px] text-[var(--color-muted)]">{a.note}</p>
          )}

          {(a.gaps.length > 0 || a.importApproximations != null) && (
            <div className="mt-2">
              <FlowChecks
                name={a.name}
                gaps={a.gaps}
                importApproximations={a.importApproximations}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
        <span className="mr-auto font-mono text-[11px] text-[var(--color-faint)]">
          {a.nodeCount} steps · {a.edgeCount} links · v{a.version} · {a.runCount} runs ·
          edited {a.updatedLabel}
        </span>

        <Link
          href={`/automations/${a.id}`}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          Open builder
        </Link>
        <button
          type="button"
          onClick={openEdit}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={duplicate}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
        >
          Duplicate
        </button>
        <PublishControl
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
        <button
          type="button"
          onClick={() => setMode("delete")}
          className="rounded-md px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
        >
          Delete
        </button>
      </div>

      {(error || flash) && (
        <div
          className={`border-t border-[var(--color-border)] px-4 py-2 text-[11.5px] ${
            error ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
          }`}
        >
          {error ?? flash}
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

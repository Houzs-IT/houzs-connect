"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { deleteChannel, updateChannel } from "./actions";

/** ⋯ in a channel's header: edit its name and topic, or delete it (admins and whoever made it). */
export function ChannelMenu({ id, name, topic, access }: { id: string; name: string; topic: string | null; access: "open" | "approval" }) {
  const { t } = useShell();
  const L = t.internal;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState({ name, topic: topic ?? "", access });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={L.channelSettings}
        title={L.channelSettings}
        className="grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-[var(--color-border)] text-[16px] leading-none text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-popover)]">
          <button
            type="button"
            className={`${item} text-[var(--color-ink)]`}
            onClick={() => {
              setDraft({ name, topic: topic ?? "", access });
              setError(null);
              setEditing(true);
              setOpen(false);
            }}
          >
            {L.editChannel}
          </button>
          <button
            type="button"
            className={`${item} text-[var(--color-danger)]`}
            onClick={() => {
              setError(null);
              setDeleting(true);
              setOpen(false);
            }}
          >
            {L.deleteChannel}
          </button>
        </div>
      )}

      <ActionDialog open={editing} title={L.editChannel} onClose={() => setEditing(false)} width="w-[420px]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await updateChannel(id, draft.name, draft.topic, draft.access);
              if (!res.ok) return setError(res.error ?? "Could not save.");
              setEditing(false);
              router.refresh();
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
            {L.channelName}
            <input
              autoFocus
              value={draft.name}
              maxLength={40}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="h-[36px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-normal outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
            {L.topic}
            <input
              value={draft.topic}
              maxLength={120}
              onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
              className="h-[36px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-normal outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <AccessChoice value={draft.access} onChange={(a) => setDraft((d) => ({ ...d, access: a }))} />
          {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)]">
              {L.cancel}
            </button>
            <button
              type="submit"
              disabled={pending || !draft.name.trim()}
              className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {pending ? L.saving : L.save}
            </button>
          </div>
        </form>
      </ActionDialog>

      <ActionConfirm
        open={deleting}
        title={fmt(L.deleteChannelTitle, { c: name })}
        confirmLabel={L.deleteChannel}
        busy={pending}
        danger
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          start(async () => {
            const res = await deleteChannel(id);
            if (!res.ok) return setError(res.error ?? "Could not delete.");
            setDeleting(false);
            router.push("/internal");
            router.refresh();
          })
        }
      >
        <p>{L.deleteChannelBody}</p>
        {error && <p className="mt-2 text-[var(--color-danger)]">{error}</p>}
      </ActionConfirm>
    </div>
  );
}

/** Open (anyone joins) or needs approval: shared by Edit channel and New channel. */
export function AccessChoice({ value, onChange }: { value: "open" | "approval"; onChange: (a: "open" | "approval") => void }) {
  const { t } = useShell();
  const L = t.internal;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-[var(--color-ink)]">{L.accessLabel}</span>
      {(["open", "approval"] as const).map((a) => (
        <label
          key={a}
          className={`flex cursor-pointer items-start gap-2.5 rounded-[8px] border px-3 py-2 ${
            value === a ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)]"
          }`}
        >
          <input type="radio" checked={value === a} onChange={() => onChange(a)} className="mt-0.5 accent-[var(--color-accent)]" />
          <span>
            <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{a === "open" ? L.accessOpen : L.accessApproval}</span>
            <span className="block text-[11.5px] text-[var(--color-faint)]">{a === "open" ? L.accessOpenHint : L.accessApprovalHint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { createTag, deleteTagEverywhere, updateTag } from "./tag-actions";

export type TagItem = { id: string; name: string; color: string; n: number };

const SWATCHES = ["#16695f", "#1e6f80", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#64748b"];

/**
 * "Manage" beside the Tags heading in Contacts' menu: rename, recolour, delete
 * and add tags in one place. Deleting takes the tag off every contact and
 * conversation (tag-actions.ts), after a confirmation that says how many.
 */
export function ManageTags({ tags }: { tags: TagItem[] }) {
  const { t } = useShell();
  const s = t.contacts;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({});
  const [doomed, setDoomed] = useState<TagItem | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(SWATCHES[0]);

  const draft = (tg: TagItem) => edits[tg.id] ?? { name: tg.name, color: tg.color };
  const changed = (tg: TagItem) => {
    const d = draft(tg);
    return d.name.trim() !== tg.name || d.color !== tg.color;
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setNote(res.ok ? { ok: true, text: s.tagSaved } : { ok: false, text: res.error ?? "Could not save." });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote(null);
          setEdits({});
          setOpen(true);
        }}
        className="rounded-[4px] px-1 text-[10px] font-semibold normal-case tracking-normal text-[var(--color-accent)] hover:bg-[var(--color-surface-dim)]"
      >
        {s.tagManage}
      </button>

      <ActionDialog open={open} title={s.tagManageTitle} subtitle={s.tagManageSub} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-1.5">
          {tags.length === 0 && <p className="text-[12.5px] text-[var(--color-faint)]">{s.tagNone}</p>}
          {tags.map((tg) => {
            const d = draft(tg);
            return (
              <div key={tg.id} className="flex items-center gap-2 rounded-[8px] border border-[var(--color-border-subtle)] px-2 py-1.5">
                <label className="relative grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full" style={{ background: d.color }} title={s.tagColour}>
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) => setEdits((x) => ({ ...x, [tg.id]: { ...d, color: e.target.value } }))}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <input
                  value={d.name}
                  maxLength={40}
                  onChange={(e) => setEdits((x) => ({ ...x, [tg.id]: { ...d, name: e.target.value } }))}
                  onKeyDown={(e) => e.key === "Enter" && changed(tg) && run(() => updateTag(tg.id, d.name, d.color))}
                  className="h-[30px] min-w-0 flex-1 rounded-[6px] border border-transparent px-1.5 text-[13px] text-[var(--color-ink)] outline-none hover:border-[var(--color-border)] focus:border-[var(--color-accent)]"
                />
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]">{fmt(s.tagUses, { n: tg.n })}</span>
                {changed(tg) && (
                  <button
                    type="button"
                    disabled={pending || !d.name.trim()}
                    onClick={() => run(() => updateTag(tg.id, d.name, d.color))}
                    className="h-[28px] shrink-0 rounded-[6px] bg-[var(--color-accent)] px-2.5 text-[12px] font-semibold text-white disabled:opacity-50"
                  >
                    {s.tagSave}
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setDoomed(tg)}
                  className="h-[28px] shrink-0 rounded-[6px] px-2 text-[12px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-50"
                >
                  {s.tagDelete}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{s.tagNew}</div>
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 gap-1">
              {SWATCHES.slice(0, 6).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setNewColor(c)}
                  className={`h-5 w-5 rounded-full ${newColor === c ? "ring-2 ring-[var(--color-ink)] ring-offset-1" : ""}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <input
              value={newName}
              maxLength={40}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newName.trim() && run(() => createTag(newName, newColor), () => setNewName(""))}
              placeholder={s.tagNewPh}
              className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              disabled={pending || !newName.trim()}
              onClick={() => run(() => createTag(newName, newColor), () => setNewName(""))}
              className="h-[32px] shrink-0 rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {s.tagAdd}
            </button>
          </div>
        </div>

        {note && <p className={`mt-3 text-[12px] ${note.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>{note.text}</p>}
      </ActionDialog>

      <ActionConfirm
        open={!!doomed}
        title={fmt(s.tagDeleteTitle, { name: doomed?.name ?? "" })}
        confirmLabel={s.tagDelete}
        busy={pending}
        danger
        onCancel={() => setDoomed(null)}
        onConfirm={() => doomed && run(() => deleteTagEverywhere(doomed.id), () => setDoomed(null))}
      >
        <p>{fmt(s.tagDeleteBody, { n: doomed?.n ?? 0 })}</p>
      </ActionConfirm>
    </>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { positionalSlots, type VarBinding } from "@/lib/automation/vars";
import { fmt } from "@/lib/i18n/dict";
import { HEADER_MEDIA, headerFileProblem, isHeaderMediaFormat } from "@/lib/template-media-limits";
import type { TemplateCounts } from "@/lib/whatsapp/templates";
import { removeTemplate, saveBindingAction, setTemplateHeaderFile } from "./actions";
import { SlotSelect } from "./SlotSelect";
import { TemplateBubble } from "./TemplateBubble";
import type { FieldOption, SampleContact, TemplateRowData } from "./types";

/** The selected template beside the list: preview, its variable mapping, its counts. */
export function TemplateSide({
  template,
  fields,
  stats,
  statsOff,
  days,
}: {
  template: TemplateRowData;
  fields: FieldOption[];
  sample: SampleContact | null;
  stats: TemplateCounts | null;
  statsOff: boolean;
  days: number;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.tf;
  const [bindings, setBindings] = useState<VarBinding[]>(template.bindings);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const slots = positionalSlots(template.body);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));
  const headerFormat = template.headerFormat;
  const mediaFormat = isHeaderMediaFormat(headerFormat) ? headerFormat : null;
  const file = template.headerFile ?? null;
  const [fileNote, setFileNote] = useState<{ ok: boolean; text: string } | null>(null);

  function uploadHeader(f: File) {
    if (!mediaFormat) return;
    const problem = headerFileProblem(mediaFormat, f);
    if (problem) return setFileNote({ ok: false, text: problem });
    setFileNote(null);
    start(async () => {
      const fd = new FormData();
      fd.set("name", template.name);
      fd.set("language", template.language);
      fd.set("format", mediaFormat);
      fd.set("file", f);
      const res = await setTemplateHeaderFile(fd);
      setFileNote(res.ok ? { ok: true, text: L.hfSaved } : { ok: false, text: res.error ?? "Could not save." });
      if (res.ok) router.refresh();
    });
  }

  const change = (n: number, next: VarBinding | null) => {
    const rest = bindings.filter((b) => b.index !== n);
    const all = next ? [...rest, next].sort((a, b) => a.index - b.index) : rest;
    setBindings(all);
    setNote(null);
    // A fixed text is saved when the field loses focus, not on every keystroke.
    if (next?.source === "literal") return;
    save(all);
  };

  const save = (all: VarBinding[]) =>
    start(async () => {
      const res = await saveBindingAction(template.name, template.language, all);
      setNote(res.ok ? { ok: true, text: L.savedMap } : { ok: false, text: res.error ?? "Could not save." });
      if (res.ok) router.refresh();
    });

  const tiles: [string, number | null, string, string][] = [
    [L.sentT, stats?.sent ?? null, "var(--color-pastel-blue)", "var(--color-pastel-blue-ink)"],
    [L.deliveredT, stats?.delivered ?? null, "var(--color-pastel-green)", "var(--color-pastel-green-ink)"],
    [L.readT, stats?.read ?? null, "var(--color-pastel-purple)", "var(--color-pastel-purple-ink)"],
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            <path d="M8.5 12h7M8.5 9h4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{template.name}</div>
          <div className="text-[11.5px] text-[var(--color-faint)]">
            {template.language} · {template.category}
          </div>
        </div>
        <Link
          href={`/settings/templates/${template.id}`}
          className="flex h-[30px] items-center rounded-[8px] border border-[var(--color-border)] px-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          {L.edit}
        </Link>
      </div>

      <div className="rounded-[12px] bg-[#ebe4d8] p-3">
        <TemplateBubble
          media={mediaFormat ? { kind: mediaFormat, src: mediaFormat === "IMAGE" ? file?.url : null, name: file?.fileName } : null}
          header={template.header}
          body={template.body}
          footer={template.footer}
          buttons={template.buttons}
        />
      </div>

      {mediaFormat && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.hfTitle}</div>
          <div
            className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 ${
              file ? "border-[var(--color-border)]" : "border-[var(--color-warning)] bg-[var(--color-pastel-orange)]"
            }`}
          >
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--color-ink)]">
              {file ? (
                <>
                  <a href={file.url} target="_blank" rel="noreferrer" className="block truncate font-semibold hover:underline">
                    {file.fileName}
                  </a>
                  <span className="text-[var(--color-faint)]">{L.hfSent}</span>
                </>
              ) : (
                fmt(L.hfMissing, {
                  kind: (mediaFormat === "IMAGE" ? L.hImage : mediaFormat === "VIDEO" ? L.hVideo : L.hDocument).toLowerCase(),
                })
              )}
            </p>
            <label
              className={`shrink-0 cursor-pointer rounded-[8px] px-2.5 py-1.5 text-[12px] font-semibold ${
                file ? "border border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]" : "bg-[var(--color-accent)] text-white"
              } ${pending ? "pointer-events-none opacity-50" : ""}`}
            >
              {file ? L.hReplace : L.hfAdd}
              <input
                type="file"
                accept={HEADER_MEDIA[mediaFormat].accept}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadHeader(f);
                }}
              />
            </label>
          </div>
          {fileNote && (
            <p className={`mt-1.5 text-[11.5px] ${fileNote.ok ? "text-[var(--color-faint)]" : "text-[var(--color-danger)]"}`}>{fileNote.text}</p>
          )}
        </div>
      )}

      {slots.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.varMapping}</div>
          <div className="flex flex-col gap-2">
            {slots.map((n) => (
              <div key={n} className="flex items-start gap-2">
                <span className="mt-1.5 rounded-[6px] bg-[var(--color-pastel-purple)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-pastel-purple-ink)]">
                  {`{{${n}}}`}
                </span>
                <SlotSelect
                  className="flex-1"
                  index={n}
                  binding={byIndex.get(n)}
                  fields={fields}
                  onChange={(next) => change(n, next)}
                />
              </div>
            ))}
          </div>
          {bindings.some((b) => b.source === "literal") && (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(bindings)}
              className="mt-2 h-[30px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"
            >
              {pending ? L.saving : t.tf.save}
            </button>
          )}
          {(note || pending) && (
            <p className={`mt-1.5 text-[11.5px] ${note && !note.ok ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
              {pending ? L.saving : note?.text}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([k, v, bg, ink]) => (
          <div key={k} className="rounded-[10px] px-2.5 py-2" style={{ background: bg }}>
            <div className="text-[11px] text-[var(--color-muted)]">{k}</div>
            <div className="text-[18px] font-semibold tabular-nums" style={{ color: ink }}>
              {v == null ? "—" : v.toLocaleString("en-US")}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--color-faint)]">{statsOff ? L.statsOff : fmt(L.statsNote, { d: days })}</p>

      {template.editBlocked && (
        <p className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] text-[var(--color-muted)]">
          <b className="font-semibold text-[var(--color-ink)]">{L.cantEdit}</b> {template.editBlocked}
        </p>
      )}

      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="self-start text-[12px] font-semibold text-[var(--color-danger)] hover:underline"
      >
        {L.delete}
      </button>
      <ActionConfirm
        open={confirm}
        title={fmt(L.deleteTitle, { name: template.name })}
        confirmLabel={L.delete}
        busy={pending}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("name", template.name);
            await removeTemplate(fd);
            setConfirm(false);
            router.push("/settings/templates");
            router.refresh();
          })
        }
      >
        <p>{L.deleteBody}</p>
      </ActionConfirm>
    </div>
  );
}

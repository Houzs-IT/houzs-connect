"use client";
import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/ShellProvider";
import { IconClose, IconPaperclip } from "../icons";
import { IT_ACCEPT, IT_MAX_FILES, isItStatus, itAddFiles, itStatusTone } from "@/lib/it-support/shared";

export const FIELD =
  "w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";
export const LABEL = "mb-1 block text-[12px] font-semibold text-[var(--color-ink)]";
export const PRIMARY =
  "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-50";
export const SECONDARY =
  "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
export const CARD = "rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card";

const TONE: Record<ReturnType<typeof itStatusTone>, string> = {
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  blue: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  purple: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
  orange: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  green: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  red: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

const CHIP = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold";

/* A state the hub added after this build is shown as the hub spelled it, not as a blank chip. */
export function StatusChip({ status }: { status: string }) {
  const { t } = useShell();
  return <span className={`${CHIP} ${TONE[itStatusTone(status)]}`}>{isItStatus(status) ? t.it.status[status] : status}</span>;
}

export function UrgencyChip({ priority }: { priority: string }) {
  const { t } = useShell();
  const words = t.it.urgencyShort as Record<string, string>;
  const hot = priority === "urgent" || priority === "high";
  return (
    <span className={`${CHIP} ${hot ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"}`}>
      {words[priority] ?? priority}
    </span>
  );
}

/** Pictures, PDF or video for a request or a reply: pick, drop, or paste a screenshot (Ctrl+V). */
export function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const { t } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [previews, setPreviews] = useState<(string | null)[]>([]);

  useEffect(() => {
    const made = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- previews follow the file list
    setPreviews(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const add = (added: File[]) => {
    const { take, skipped } = itAddFiles(files, added);
    setNote(skipped.length ? skipped.join(". ") : null);
    if (take.length) onChange([...files, ...take.map((i) => added[i])]);
  };
  const addRef = useRef(add);
  useEffect(() => { addRef.current = add; });

  // A pasted screenshot arrives as an unnamed image; it gets a name IT can tell apart.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (!pasted.length) return;
      e.preventDefault();
      const stamp = Date.now();
      addRef.current(pasted.map((f, i) => new File([f], `screenshot-${stamp}-${i + 1}.${f.type.split("/")[1] || "png"}`, { type: f.type })));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {files.length < IT_MAX_FILES && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(Array.from(e.dataTransfer.files)); }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-[10px] border-2 border-dashed px-4 py-5 text-center ${
            dragging ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
          }`}
        >
          <input ref={input} type="file" multiple accept={IT_ACCEPT} className="hidden"
            onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <IconPaperclip width={18} height={18} className="text-[var(--color-accent)]" />
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">{t.it.dropHint}</span>
          <span className="text-[11.5px] text-[var(--color-faint)]">{t.it.dropLimits}</span>
        </label>
      )}
      {note && <p role="status" className="text-[12px] text-[var(--color-warning)]">{note}</p>}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative h-20 w-20">
              {previews[i] ? (
                <button type="button" onClick={() => setViewing(i)} title={f.name}
                  className="block h-full w-full overflow-hidden rounded-[8px] border border-[var(--color-border)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previews[i]!} alt={f.name} className="h-full w-full object-cover" />
                </button>
              ) : (
                <div title={f.name} className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-center text-[10px] text-[var(--color-muted)]">
                  <IconPaperclip width={16} height={16} />
                  <span className="w-full truncate">{f.name}</span>
                </div>
              )}
              <button type="button" aria-label={`${t.it.remove} ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-ink)] text-white">
                <IconClose width={11} height={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {viewing !== null && previews[viewing] && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={files[viewing]?.name}>
          <button type="button" aria-label={t.it.close} onClick={() => setViewing(null)} className="absolute inset-0 bg-black/70" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previews[viewing]!} alt={files[viewing]?.name} className="relative max-h-[85vh] max-w-full rounded-[10px]" />
        </div>
      )}
    </div>
  );
}

/** A JSON call to our own /api/it-support, with the server's sentence on failure. */
export async function itCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/it-support${path}`, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = body?.code;
    throw err;
  }
  return body as T;
}

"use client";

import { PersonAvatar } from "@/components/PersonAvatar";
import { usePhotoUpload } from "@/components/usePhotoUpload";
import { initials, tint } from "@/lib/format";
import { removeMyPhoto, uploadMyPhoto } from "./actions";

/**
 * The avatar on Settings → My profile, with one "Choose photo…" button (a
 * hidden file input, as on the business-profile editor — Tailwind's preflight
 * leaves the browser's own file control looking like plain text) and Remove.
 */
export function PhotoEditor({ name, photo }: { name: string; photo: string | null }) {
  const { L, src, busy, note, input, onPicked, onRemove, pick } = usePhotoUpload({
    photo,
    upload: uploadMyPhoto,
    remove: removeMyPhoto,
  });
  const tone = tint(name);

  const btn =
    "rounded-[8px] border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-60";

  return (
    <div className="flex items-center gap-4 border-t border-[var(--color-border-subtle)] p-4">
      <PersonAvatar name={name} photo={src} size={64} className={busy === "upload" ? "opacity-60" : ""}>
        <span
          className="grid h-16 w-16 shrink-0 place-items-center rounded-full text-[20px] font-bold"
          style={{ background: `color-mix(in srgb, ${tone} 14%, white)`, color: tone }}
        >
          {initials(name)}
        </span>
      </PersonAvatar>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--color-ink)]">{L.photo}</div>
        <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{L.photoSub}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={onPicked} />
          <button
            type="button"
            disabled={!!busy}
            onClick={pick}
            className={`${btn} bg-[var(--color-surface-2)] text-[var(--color-ink)] hover:bg-[var(--color-surface)]`}
          >
            {busy === "upload" ? L.photoUploading : src ? L.photoChange : L.photoChoose}
          </button>
          {src && (
            <button
              type="button"
              disabled={!!busy}
              onClick={onRemove}
              className={`${btn} text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]`}
            >
              {busy === "remove" ? L.photoRemoving : L.photoRemove}
            </button>
          )}
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{L.photoHint}</p>
        {note && (
          <p
            role={note.ok ? "status" : "alert"}
            className={`mt-1.5 text-[12px] ${note.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}
          >
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}

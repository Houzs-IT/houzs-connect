"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useShell } from "@/components/shell/ShellProvider";
import { initials, tint } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import {
  PHOTO_EDGE,
  PHOTO_QUALITY,
  PHOTO_SOURCE_MAX_BYTES,
  type PhotoError,
} from "@/lib/member-photo-limits";
import { removeMyPhoto, uploadMyPhoto } from "./actions";

/**
 * Decode the picked file, crop the centred square, scale it to PHOTO_EDGE and
 * re-encode it as a JPEG. Decoding through an <img> applies the camera's EXIF
 * rotation; re-encoding drops the rest of the EXIF, location included.
 */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("empty image");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PHOTO_EDGE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    // A transparent PNG would come out black in a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PHOTO_EDGE, PHOTO_EDGE);
    ctx.imageSmoothingQuality = "high";
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_EDGE, PHOTO_EDGE);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", PHOTO_QUALITY)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Note = { ok: boolean; text: string } | null;

/**
 * The avatar on Settings → My profile, with one "Choose photo…" button (a
 * hidden file input, as on the business-profile editor — Tailwind's preflight
 * leaves the browser's own file control looking like plain text) and Remove.
 */
export function PhotoEditor({ name, photo }: { name: string; photo: string | null }) {
  const { t } = useShell();
  const L = t.set;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [note, setNote] = useState<Note>(null);
  // Shown in place of `photo` until the server renders the new one: the shrunk
  // upload, or nothing after Remove. Pinned to the `photo` it replaces, so the
  // next server render wins without an effect to reset it.
  const [local, setLocal] = useState<{ over: string | null; src: string | null } | null>(null);
  const lastPreview = useRef<string | null>(null);
  const src = local && local.over === photo ? local.src : photo;
  const tone = tint(name);

  const errText = (e: PhotoError) =>
    e === "signin" ? L.photoErrSignin : e === "save" ? L.photoErrSave : L.photoErrUpload;

  async function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again must fire again
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNote({ ok: false, text: L.photoErrNotImage });
      return;
    }
    if (file.size > PHOTO_SOURCE_MAX_BYTES) {
      setNote({ ok: false, text: fmt(L.photoErrTooBig, { mb: (file.size / 1048576).toFixed(1) }) });
      return;
    }

    setBusy("upload");
    setNote(null);
    let jpeg: Blob;
    try {
      jpeg = await squareJpeg(file);
    } catch {
      setBusy(null);
      setNote({ ok: false, text: L.photoErrRead });
      return;
    }

    if (lastPreview.current) URL.revokeObjectURL(lastPreview.current);
    lastPreview.current = URL.createObjectURL(jpeg);
    setLocal({ over: photo, src: lastPreview.current });
    try {
      const fd = new FormData();
      fd.append("photo", jpeg, "photo.jpg");
      const r = await uploadMyPhoto(fd);
      if (r.ok) {
        setNote({ ok: true, text: L.photoSaved });
        router.refresh();
      } else {
        setLocal(null);
        setNote({ ok: false, text: errText(r.error) });
      }
    } catch {
      setLocal(null);
      setNote({ ok: false, text: L.photoErrSave });
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy("remove");
    setNote(null);
    try {
      const r = await removeMyPhoto();
      if (r.ok) {
        setLocal({ over: photo, src: null });
        setNote({ ok: true, text: L.photoRemoved });
        router.refresh();
      } else {
        setNote({ ok: false, text: errText(r.error) });
      }
    } catch {
      setNote({ ok: false, text: L.photoErrSave });
    } finally {
      setBusy(null);
    }
  }

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
            onClick={() => input.current?.click()}
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

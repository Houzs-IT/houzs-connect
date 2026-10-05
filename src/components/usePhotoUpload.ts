"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import {
  PHOTO_EDGE,
  PHOTO_QUALITY,
  PHOTO_SOURCE_MAX_BYTES,
  type PhotoError,
  type PhotoResult,
} from "@/lib/member-photo-limits";

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

export type PhotoNote = { ok: boolean; text: string } | null;

/**
 * Picking, shrinking and uploading a profile photo, shared by My profile (your
 * own) and Team (an admin setting someone else's). `upload` receives the JPEG
 * as `photo` in a FormData; both actions answer a PhotoResult.
 *
 * `src` is what to show: the server's `photo`, or — until the server renders
 * the new one — the shrunk upload, or nothing after Remove. The override is
 * pinned to the `photo` it replaces, so the next server render wins without an
 * effect to reset it.
 */
export function usePhotoUpload({
  photo,
  upload,
  remove,
}: {
  photo: string | null;
  upload: (fd: FormData) => Promise<PhotoResult>;
  remove: () => Promise<PhotoResult>;
}) {
  const { t } = useShell();
  const L = t.set;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [note, setNote] = useState<PhotoNote>(null);
  const [local, setLocal] = useState<{ over: string | null; src: string | null } | null>(null);
  const lastPreview = useRef<string | null>(null);
  const src = local && local.over === photo ? local.src : photo;

  const errText = (e: PhotoError) =>
    e === "signin"
      ? L.photoErrSignin
      : e === "forbidden"
        ? L.photoErrForbidden
        : e === "save"
          ? L.photoErrSave
          : L.photoErrUpload;

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
      const r = await upload(fd);
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
      const r = await remove();
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

  return { L, src, busy, note, input, onPicked, onRemove, pick: () => input.current?.click() };
}

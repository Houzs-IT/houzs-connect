"use client";

import { useEffect, useRef, useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { usePhotoUpload } from "@/components/usePhotoUpload";
import { fmt } from "@/lib/i18n/dict";
import { removePhotoFor, uploadPhotoFor } from "./photo-actions";

/**
 * A Team row's avatar, as a button: an owner or admin clicks it to choose or
 * remove that person's photo. `children` is the row's own initials look.
 *
 * The menu is position: fixed, placed from the button — the table sits in an
 * overflow-x-auto box, which would clip an absolutely positioned one.
 */
export function TeamPhoto({
  email,
  name,
  photo,
  children,
}: {
  email: string;
  name: string;
  photo: string | null;
  children: React.ReactNode;
}) {
  const { L, src, busy, note, input, onPicked, onRemove, pick } = usePhotoUpload({
    photo,
    upload: (fd) => {
      fd.append("email", email);
      return uploadPhotoFor(fd);
    },
    remove: () => removePhotoFor(email),
  });
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const label = fmt(L.photoEditFor, { name });

  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAt(null);
    // A fixed menu would drift from its row as the page scrolls.
    const close = () => setAt(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  function toggle() {
    if (at) return setAt(null);
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)) });
  }

  const item =
    "flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-60";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label={label}
        title={label}
        className={`group/photo relative shrink-0 rounded-full outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-ring)] ${
          busy === "upload" ? "opacity-60" : ""
        }`}
      >
        <PersonAvatar name={name} photo={src} size={32}>
          {children}
        </PersonAvatar>
        {/* A camera on hover, so the avatar reads as something to click. */}
        <span className="absolute inset-0 hidden place-items-center rounded-full bg-[rgba(11,16,32,0.45)] text-white group-hover/photo:grid">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={onPicked} />

      {at && (
        <div
          ref={menu}
          role="menu"
          style={{ position: "fixed", top: at.top, left: at.left }}
          className="z-50 w-60 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]"
        >
          <div className="truncate px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            {name}
          </div>
          <button type="button" role="menuitem" disabled={!!busy} onClick={pick} className={`${item} text-[var(--color-ink)]`}>
            {busy === "upload" ? L.photoUploading : src ? L.photoChange : L.photoChoose}
          </button>
          {src && (
            <button
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={onRemove}
              className={`${item} text-[var(--color-muted)] hover:text-[var(--color-danger)]`}
            >
              {busy === "remove" ? L.photoRemoving : L.photoRemove}
            </button>
          )}
          {note && (
            <p
              role={note.ok ? "status" : "alert"}
              className={`border-t border-[var(--color-border-subtle)] px-3 py-2 text-[12px] ${
                note.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
              }`}
            >
              {note.text}
            </p>
          )}
        </div>
      )}
    </>
  );
}

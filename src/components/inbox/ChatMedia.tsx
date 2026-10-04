"use client";

import { useState } from "react";

/**
 * A picture or file inside a chat bubble. Images show inline (click opens the
 * full size in a new tab); other files show as a named file to open. Meta only
 * keeps media for a limited time, so a picture that no longer loads says so
 * instead of showing a broken image.
 */
export function ChatMedia({
  src,
  kind,
  fileName,
  goneLabel,
  openLabel,
}: {
  src: string;
  kind: "IMAGE" | "DOCUMENT";
  fileName: string | null;
  goneLabel: string;
  openLabel: string;
}) {
  const [gone, setGone] = useState(false);

  if (kind === "IMAGE" && !gone) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block" title={openLabel}>
        {/* eslint-disable-next-line @next/next/no-img-element -- streamed from Meta via our own route, not a static asset */}
        <img
          src={src}
          alt={fileName ?? ""}
          loading="lazy"
          onError={() => setGone(true)}
          className="max-h-72 max-w-full rounded-[10px] object-contain"
        />
      </a>
    );
  }

  if (gone) {
    return <p className="text-[12px] italic text-[var(--color-faint)]">{goneLabel}</p>;
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-pastel-blue)] text-[13px] text-[var(--color-pastel-blue-ink)]">▤</span>
      <span className="min-w-0 truncate font-medium">{fileName ?? openLabel}</span>
    </a>
  );
}

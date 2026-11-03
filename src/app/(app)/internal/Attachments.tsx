"use client";

import { useEffect, useState } from "react";
import { attachmentUrl, fmtSize, type InternalAttachment } from "@/lib/internal-media";

/** Text-ish types we can show as plain text in the preview (fetched on open). */
const TEXT_MIME = /^(text\/|application\/(json|xml|x-ndjson|javascript|csv))/i;
const isPdf = (m: string) => m === "application/pdf";
const isText = (a: InternalAttachment) => a.kind !== "image" && !isPdf(a.mime) && TEXT_MIME.test(a.mime);

/**
 * A message's images and files. Everything opens a preview INSIDE the
 * conversation first — images and PDFs render, text files show their contents,
 * and anything with no in-browser preview shows a file card. The viewer always
 * has a Download button, so people look before they save. Every byte is
 * streamed from our own origin (/internal/media/[id]), so nothing here needs a
 * CDN or a CSP exception.
 */
export function Attachments({
  items,
  labels,
}: {
  items: InternalAttachment[];
  labels: { download: string; image: string; preview: string; noPreview: string };
}) {
  const images = items.filter((a) => a.kind === "image");
  const files = items.filter((a) => a.kind !== "image");
  const [open, setOpen] = useState<InternalAttachment | null>(null);
  // Fetched text for a text-file preview, scoped to the open attachment's id.
  const [text, setText] = useState<{ id: string; body: string | null; err: boolean } | null>(null);
  const single = images.length === 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !isText(open)) return;
    // Only ever set `text` from the async callbacks (never synchronously in the
    // effect body — a lint rule here). Until this id's fetch resolves, `text`
    // still holds the previous file (or nothing), so the render shows "…".
    const id = open.id;
    let cancelled = false;
    fetch(attachmentUrl(id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!cancelled) setText({ id, body: t.slice(0, 200_000), err: false });
      })
      .catch(() => {
        if (!cancelled) setText({ id, body: null, err: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {images.length > 0 && (
        <div className="flex max-w-[344px] flex-wrap gap-1">
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              aria-label={a.name || labels.image}
              className={`overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] ${
                single ? "block" : "h-[112px] w-[112px]"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentUrl(a.id)}
                alt={a.name || labels.image}
                loading="lazy"
                className={single ? "max-h-[360px] max-w-full object-contain" : "h-full w-full object-cover"}
              />
            </button>
          ))}
        </div>
      )}

      {files.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => setOpen(a)}
          title={labels.preview}
          className="flex max-w-[340px] items-center gap-2.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-soft)] text-[15px]">📄</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-[var(--color-ink)]">{a.name}</span>
            <span className="block text-[11.5px] text-[var(--color-faint)]">{fmtSize(a.size)}</span>
          </span>
          <span className="shrink-0 text-[13px] text-[var(--color-muted)]">›</span>
        </button>
      ))}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          {open.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachmentUrl(open.id)}
              alt={open.name || labels.image}
              className="max-h-full max-w-full rounded-[8px] object-contain"
            />
          ) : isPdf(open.mime) ? (
            <iframe
              src={attachmentUrl(open.id)}
              title={open.name}
              onClick={(e) => e.stopPropagation()}
              className="h-[82vh] w-[92vw] max-w-[920px] rounded-[8px] border-0 bg-white"
            />
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[82vh] w-[92vw] max-w-[720px] flex-col overflow-hidden rounded-[12px] bg-[var(--color-surface)]"
            >
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-soft)] text-[14px]">📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{open.name}</span>
                  <span className="block text-[11.5px] text-[var(--color-faint)]">{fmtSize(open.size)}</span>
                </span>
              </div>
              {isText(open) ? (
                text?.id === open.id && text.err ? (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">{labels.noPreview}</p>
                ) : text?.id === open.id && text.body !== null ? (
                  <pre className="scroll-thin m-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[12.5px] leading-[1.55] text-[var(--color-ink)]">
                    {text.body}
                  </pre>
                ) : (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">…</p>
                )
              ) : (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">{labels.noPreview}</p>
              )}
            </div>
          )}

          <a
            href={attachmentUrl(open.id, true)}
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-5 right-5 rounded-[8px] bg-white/90 px-3 py-1.5 text-[13px] font-semibold text-black hover:bg-white"
          >
            ↓ {labels.download}
          </a>
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[18px] text-black hover:bg-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

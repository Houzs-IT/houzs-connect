// Internal chat attachments — the client-safe half.
//
// Constants, kinds and tiny formatters shared by the composer (browser), the
// send action (server) and the serve route (server). It deliberately imports
// NOTHING server-only (no getCloudflareContext), so the client bundle can use
// it the same way media-limits.ts serves the inbox composer. The R2 bucket
// itself is reached through getCloudflareContext().env.FILES in the action and
// the route, never here.

/** How many files may ride on one message, WhatsApp-group style. */
export const MAX_ATTACHMENTS = 10;

// Per-file and per-message caps. The send is a server action, whose body Next
// caps at 20 MB (serverActions.bodySizeLimit in next.config.ts) and which runs
// inside a 128 MB Cloudflare isolate — so these stay comfortably under 20 MB
// including multipart overhead. 15 MB/file is about WhatsApp's own image ceiling.
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

export type AttachmentKind = "image" | "file";

/** Raster image types we are willing to render inline in a bubble and a lightbox. */
const INLINE_IMAGE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** How a mime type is shown: an inline picture, or a download row. SVG is a
 *  file on purpose — it can carry script, so it is never rendered inline. */
export function kindFor(mime: string): AttachmentKind {
  return INLINE_IMAGE.has(mime) ? "image" : "file";
}

/** May the serve route hand this back with `Content-Disposition: inline`? Only
 *  raster images and PDFs; everything else downloads (see the route's nosniff). */
export function inlineOk(mime: string): boolean {
  return INLINE_IMAGE.has(mime) || mime === "application/pdf";
}

/** A human size: "820 KB", "3.4 MB". */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** One attachment as the timeline renders it (metadata only; bytes come from the route). */
export type InternalAttachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
};

/** Where to fetch an attachment's bytes. `download` forces a save instead of inline. */
export function attachmentUrl(id: string, download = false): string {
  return `/internal/media/${id}${download ? "?download=1" : ""}`;
}

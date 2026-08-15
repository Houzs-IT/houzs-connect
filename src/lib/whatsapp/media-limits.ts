/**
 * Meta's media rules for the WhatsApp Cloud API, in ONE place.
 *
 * Both the composer (browser) and the upload server action import this, so this
 * module must stay free of any server-only import — no env, no db, no drizzle.
 * Checking here is the whole point: a file Meta will not take comes back from
 * Graph as "(#100) Invalid parameter", which tells the operator nothing about
 * what they did wrong. The same check runs again on the server, because the
 * browser one is a courtesy and anyone can POST the action directly.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */

export type AttachmentKind = "IMAGE" | "DOCUMENT";

/** The only image types the Cloud API media endpoint accepts. */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;

/** The document types Meta lists. Note CSV is NOT on it — .csv is rejected. */
export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

/** Meta's hard cap for images. Nothing we can do about this one. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Meta's hard cap for documents — what the Cloud API itself would accept. */
export const META_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/**
 * What THIS deployment accepts for a document, which is far below Meta's 100 MB.
 *
 * The upload runs inside a Cloudflare Worker: the file arrives as a server-action
 * body, is materialised in the isolate, and is then re-sent as a multipart body
 * to Graph — so peak memory is a small multiple of the file size against a 128 MB
 * per-isolate limit, and the whole thing is bounded again by Next's server-action
 * body limit (see `experimental.serverActions.bodySizeLimit` in next.config.ts).
 * 16 MB sits comfortably inside both. Raising this without moving the upload off
 * the Worker (direct-to-Graph from the browser, or R2) will fail at runtime, not
 * in review.
 */
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** `accept` for the file input — the same list, in the browser's format. */
export const ATTACHMENT_ACCEPT = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES].join(",");

/**
 * Extension → mime, for the case the browser hands us "" or a generic
 * octet-stream (it happens on Windows for .docx/.xlsx when no app is
 * registered). Meta REQUIRES a concrete `type` on the upload, so guessing from
 * the extension is better than sending octet-stream and being refused.
 */
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The mime we will actually declare to Meta for this file. */
export function resolveMimeType(fileName: string, reportedType: string): string {
  const reported = reportedType.trim().toLowerCase().split(";")[0];
  if (reported && reported !== "application/octet-stream") return reported;
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return EXTENSION_MIME[ext] ?? reported;
}

export function classifyAttachment(mimeType: string): AttachmentKind | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return "IMAGE";
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) return "DOCUMENT";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; error: string };

/**
 * Is this file sendable? Returns the resolved kind + mime on success, and a
 * sentence an operator can act on when not.
 */
export function checkAttachment(file: {
  name: string;
  type: string;
  size: number;
}): AttachmentCheck {
  const name = file.name || "This file";
  if (!file.size) return { ok: false, error: `“${name}” is empty.` };

  const mimeType = resolveMimeType(file.name, file.type);
  const kind = classifyAttachment(mimeType);
  if (!kind) {
    return {
      ok: false,
      error:
        `WhatsApp will not accept “${name}”. Images have to be JPEG or PNG; ` +
        `documents have to be PDF, Word, Excel, PowerPoint or plain text.`,
    };
  }

  if (kind === "IMAGE" && file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `“${name}” is ${formatBytes(file.size)}. WhatsApp caps images at ${formatBytes(
        MAX_IMAGE_BYTES
      )} — resize it and try again.`,
    };
  }

  if (kind === "DOCUMENT" && file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `“${name}” is ${formatBytes(file.size)}. This inbox sends documents up to ${formatBytes(
        MAX_DOCUMENT_BYTES
      )} — Meta's own limit is ${formatBytes(
        META_MAX_DOCUMENT_BYTES
      )}, but the upload runs through a Cloudflare Worker that cannot hold a file that large.`,
    };
  }

  return { ok: true, kind, mimeType };
}

/**
 * A filename Meta and the multipart encoder will both tolerate: no path
 * separators, no control characters, not absurdly long. Filtered by code point
 * rather than by regex so no control character is ever written into this file.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return (cleaned || "attachment").slice(0, 200);
}

/** Meta caps media captions at 1024 characters. */
export const MAX_CAPTION_CHARS = 1024;

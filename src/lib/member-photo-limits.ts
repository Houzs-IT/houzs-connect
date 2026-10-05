// Profile-photo limits and result shape, shared by the browser (the picker on
// Settings → My profile) and the server (its actions). A "use server" module
// may only export async functions, so these live here; nothing server-only may
// be imported.

/** Every photo is cropped to a centred square and scaled to this edge in the browser before upload. */
export const PHOTO_EDGE = 256;

/** JPEG quality for that re-encode — a 256×256 photo comes out around 15–40 KB. */
export const PHOTO_QUALITY = 0.86;

/** The largest file the picker will try to decode. Phone cameras shoot 3–12 MB. */
export const PHOTO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** What the server accepts: the shrunk JPEG, with room to spare. */
export const PHOTO_UPLOAD_MAX_BYTES = 300 * 1024;

export type PhotoError = "signin" | "empty" | "type" | "size" | "save";
export type PhotoResult = { ok: true } | { ok: false; error: PhotoError };

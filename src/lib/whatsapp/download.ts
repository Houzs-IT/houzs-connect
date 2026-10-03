// Fetch a customer's media (a payment slip, a photo) back from Meta.
//
// Two hops, per the Cloud API: GET /{media-id} returns a short-lived URL, and
// that URL needs the same bearer token to download. The token never leaves the
// server — pages get the bytes through a company-scoped route instead.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#download-media

import { metaToken } from "./token";

const GRAPH = "https://graph.facebook.com/v23.0";

export type Downloaded = { ok: true; bytes: ArrayBuffer; mimeType: string } | { ok: false; status: number; error: string };

/** `whatsapp-media:<id>` → the id, or null for anything else. */
export function mediaIdOf(stored: string | null | undefined): string | null {
  return stored?.startsWith("whatsapp-media:") ? stored.slice("whatsapp-media:".length) || null : null;
}

export async function downloadMedia(mediaId: string): Promise<Downloaded> {
  const token = metaToken();
  if (!token) return { ok: false, status: 503, error: "WhatsApp is not connected." };
  try {
    const meta = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!meta.ok) return { ok: false, status: meta.status === 404 ? 404 : 502, error: `Meta answered ${meta.status} for this media.` };
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) return { ok: false, status: 502, error: "Meta gave no download address." };
    const file = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!file.ok) return { ok: false, status: 502, error: `Meta answered ${file.status} for the file.` };
    return { ok: true, bytes: await file.arrayBuffer(), mimeType: info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream" };
  } catch (e) {
    return { ok: false, status: 504, error: (e as Error)?.message ?? "Network error while asking Meta for the file." };
  }
}

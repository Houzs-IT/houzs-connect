// Keep our own copy of a customer's inbound media.
//
// Meta retains WhatsApp media for only a limited time (~30 days), after which
// GET /{media-id} answers 404 and the thread can only say "no longer available"
// (see lib/whatsapp/download.ts and the inbox media route). So at receipt we
// pull the bytes back once and store them in the same FILES R2 bucket the
// Internal chat uses (lib/internal-media.ts) — the file then outlives Meta's
// window and the serve route streams it from us.
//
// Best-effort by design: any failure (no bucket, Meta hiccup, oversized file)
// returns null and the message keeps its Meta mediaId, which the serve route
// still tries. A customer's delivery is never failed for this.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { downloadMedia } from "./download";

export type StoredInboundMedia = { r2Key: string; mime: string; size: number };

export async function storeInboundMedia(opts: {
  mediaId: string;
  companyId: string;
  conversationId: string;
  messageId: string;
}): Promise<StoredInboundMedia | null> {
  const bucket = getCloudflareContext().env.FILES;
  if (!bucket) return null;

  const file = await downloadMedia(opts.mediaId);
  if (!file.ok) return null;

  // Namespaced like Internal attachments: company → conversation → message. One
  // media per inbound message, so the message id is a stable, unique leaf.
  const key = `whatsapp/${opts.companyId}/${opts.conversationId}/${opts.messageId}`;
  await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.mimeType } });
  return { r2Key: key, mime: file.mimeType, size: file.bytes.byteLength };
}

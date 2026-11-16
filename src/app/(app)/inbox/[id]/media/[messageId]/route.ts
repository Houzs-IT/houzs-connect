import { and, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { message } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { downloadMedia, mediaIdOf } from "@/lib/whatsapp/download";

/**
 * A picture or file in a chat — sent by the customer or by us — so the thread
 * can show it. Signed-in members of the conversation's own company only; the
 * WhatsApp token stays on the server.
 *
 * We keep our own copy of inbound media in R2 at receipt (store-inbound-media.ts),
 * so this serves it from us — it outlives Meta's ~30-day retention. Only when
 * there is no R2 copy (an older message, or a store that failed) do we fall back
 * to fetching from Meta, which answers 404 once the window passes, and then the
 * thread says the file is no longer available.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id, messageId } = await params;

  const row = await getDb().query.message.findFirst({
    where: and(eq(message.id, messageId), eq(message.conversationId, id)),
    with: { conversation: { with: { channel: true } } },
  });
  if (!row || row.conversation.channel.companyId !== me.companyId) return new Response("Not found", { status: 404 });

  const payload = (row.interactivePayload ?? {}) as { mediaId?: unknown; fileName?: unknown; r2Key?: unknown; mimeType?: unknown };
  const name = typeof payload.fileName === "string" && payload.fileName ? payload.fileName : `whatsapp-${messageId}`;
  const headers = (mime: string) => ({
    "content-type": mime,
    // Private: chat media is customer data. An hour saves a round trip while
    // someone scrolls the thread.
    "cache-control": "private, max-age=3600",
    "content-disposition": `inline; filename="${name.replace(/["\\\r\n]/g, "_")}"`,
  });

  // Our own copy first — present for anything received since we started keeping
  // copies. A recorded key whose object is missing falls through to Meta.
  if (typeof payload.r2Key === "string" && payload.r2Key) {
    const bucket = getCloudflareContext().env.FILES;
    const obj = bucket ? await bucket.get(payload.r2Key) : null;
    if (obj) {
      const mime =
        obj.httpMetadata?.contentType ??
        (typeof payload.mimeType === "string" && payload.mimeType ? payload.mimeType : "application/octet-stream");
      return new Response(obj.body, { headers: headers(mime) });
    }
  }

  const mediaId = (typeof payload.mediaId === "string" && payload.mediaId) || mediaIdOf(row.mediaUrl);
  if (!mediaId) return new Response("No file", { status: 404 });

  const file = await downloadMedia(mediaId);
  if (!file.ok) return new Response(file.error, { status: file.status });
  return new Response(file.bytes, { headers: headers(file.mimeType) });
}

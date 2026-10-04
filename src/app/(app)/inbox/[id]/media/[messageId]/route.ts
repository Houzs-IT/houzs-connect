import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { message } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { downloadMedia, mediaIdOf } from "@/lib/whatsapp/download";

/**
 * A picture or file in a chat — sent by the customer or by us — streamed from
 * Meta so the thread can show it. Signed-in members of the conversation's own
 * company only; the WhatsApp token stays on the server. Meta keeps media for
 * a limited time, after which this answers 404 and the thread says so.
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

  const payload = (row.interactivePayload ?? {}) as { mediaId?: unknown; fileName?: unknown };
  const mediaId = (typeof payload.mediaId === "string" && payload.mediaId) || mediaIdOf(row.mediaUrl);
  if (!mediaId) return new Response("No file", { status: 404 });

  const file = await downloadMedia(mediaId);
  if (!file.ok) return new Response(file.error, { status: file.status });
  const name = typeof payload.fileName === "string" && payload.fileName ? payload.fileName : `whatsapp-${messageId}`;
  return new Response(file.bytes, {
    headers: {
      "content-type": file.mimeType,
      // Private: chat media is customer data. An hour saves a Meta round trip
      // while someone scrolls the thread.
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="${name.replace(/["\\\r\n]/g, "_")}"`,
    },
  });
}

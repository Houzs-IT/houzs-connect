import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { downloadMedia, mediaIdOf } from "@/lib/whatsapp/download";

/**
 * A photo, file or voice note from a chat, streamed from Meta for members of
 * the message's own company. `?download=1` saves instead of showing it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const row = await getDb().query.message.findFirst({
    where: (m, { eq }) => eq(m.id, id),
    with: { conversation: { with: { contact: true } } },
  });
  if (!row || row.conversation.contact.companyId !== me.companyId) return new Response("Not found", { status: 404 });
  const mediaId = mediaIdOf(row.mediaUrl);
  if (!mediaId) return new Response("No file", { status: 404 });
  const file = await downloadMedia(mediaId);
  if (!file.ok) return new Response(file.error, { status: file.status });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = (row.body ?? "").trim().split("\n")[0].replace(/[^\w.\- ]+/g, "").slice(0, 80) || `file-${id}`;
  return new Response(file.bytes, {
    headers: {
      "content-type": file.mimeType,
      "cache-control": "private, max-age=3600",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    },
  });
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { payment } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { downloadMedia, mediaIdOf } from "@/lib/whatsapp/download";

/**
 * The receipt image a customer sent, streamed from Meta. Signed-in members of
 * the payment's own company only; the WhatsApp token stays on the server.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const row = await getDb().query.payment.findFirst({ where: eq(payment.id, id), with: { contact: true } });
  if (!row || row.contact.companyId !== me.companyId) return new Response("Not found", { status: 404 });
  const mediaId = mediaIdOf(row.receiptMediaUrl);
  if (!mediaId) return new Response("No image", { status: 404 });

  const file = await downloadMedia(mediaId);
  if (!file.ok) return new Response(file.error, { status: file.status });
  return new Response(file.bytes, {
    headers: {
      "content-type": file.mimeType,
      // Private: a receipt is customer data. An hour saves a Meta round trip
      // while someone flips between receipts.
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="receipt-${id}"`,
    },
  });
}

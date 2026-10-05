import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { storedHeaderFile } from "@/lib/whatsapp/templateMedia";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });

/**
 * A template's stored header file (lib/whatsapp/templateMedia.ts), for the
 * Templates page preview. Signed-in staff only: Meta never fetches this, the
 * send path uploads the file to WhatsApp itself. With a `?v=` matching the
 * stored file the answer is cached for a year (a new file is a new URL).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentMember())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const file = await storedHeaderFile(getDb(), id);
    if (!file) return notFound();
    const current = new URL(req.url).searchParams.get("v") === String(file.updatedAt.getTime());
    return new Response(file.bytes, {
      headers: {
        // Only JPEG, PNG or PDF: the upload actions refuse anything else.
        "content-type": file.mimeType,
        "content-disposition": `inline; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
        "cache-control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.warn("[template-media] read failed:", e);
    return notFound();
  }
}

import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { inlineOk } from "@/lib/internal-media";
import { channelInfo } from "../../data";

export const dynamic = "force-dynamic";

/**
 * An image or file from an Internal chat message, streamed from the FILES R2
 * bucket. Two gates, both required: the attachment must belong to the caller's
 * company, AND the caller must be a member of the channel/DM it lives in —
 * being in the company is not enough. The bytes never leave our own origin, so
 * there is no CDN URL and no CSP exception to manage.
 *
 * Images and PDFs render inline; everything else downloads. `nosniff` plus the
 * octet-stream type on the download path stop a mislabelled upload (an .html or
 * .svg dressed as an image) from ever being run as what it pretends to be.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const rows = (await getDb().execute(sql`
    select channel_id, company_id, kind, r2_key, name, mime
    from connect.internal_attachment where id = ${id}
  `)) as unknown as { channel_id: string; company_id: string; r2_key: string; name: string; mime: string }[];
  const a = rows[0];
  if (!a || a.company_id !== me.companyId) return new Response("Not found", { status: 404 });

  const ch = await channelInfo(me.companyId, a.channel_id, me.id);
  if (!ch || !ch.isMember) return new Response("Not found", { status: 404 });

  const bucket = getCloudflareContext().env.FILES;
  if (!bucket) return new Response("File storage is not set up.", { status: 500 });
  const obj = await bucket.get(a.r2_key);
  if (!obj) return new Response("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.has("download");
  const inline = inlineOk(a.mime) && !download;
  // Two filenames: a plain ASCII fallback, and RFC 5987 UTF-8 for names with
  // Chinese characters (which the staff here use constantly).
  const ascii = (a.name || "file").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(a.name || "file");

  return new Response(obj.body, {
    headers: {
      "content-type": inline ? a.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      "x-content-type-options": "nosniff",
      // Private: staff chat content. An hour saves a round trip while scrolling.
      "cache-control": "private, max-age=3600",
    },
  });
}

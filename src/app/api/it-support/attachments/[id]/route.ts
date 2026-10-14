import { hubFetch, hubFor, IT_UNAVAILABLE, itJson } from "@/lib/it-support/hub";

/**
 * GET /api/it-support/attachments/:id — a file on one of my requests, streamed
 * through so the hub key stays here. The hub only serves files on the caller's
 * own requests, and never one attached to an internal note.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return itJson({ error: "Not found" }, 404);
  let res: Response;
  try {
    res = await hubFetch(hub, `/attachments/${id}`);
  } catch {
    return itJson({ error: IT_UNAVAILABLE }, 502);
  }
  if (res.status === 404) return itJson({ error: "Not found" }, 404);
  if (!res.ok || !res.body) return itJson({ error: IT_UNAVAILABLE }, 502);
  const headers = new Headers({ "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
  headers.set("content-type", res.headers.get("content-type") ?? "application/octet-stream");
  const disposition = res.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(res.body, { status: 200, headers });
}

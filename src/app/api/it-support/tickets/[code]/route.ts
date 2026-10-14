import { hubFetch, hubFor, itJson, relay } from "@/lib/it-support/hub";
import { IT_CODE } from "@/lib/it-support/shared";

/** GET /api/it-support/tickets/:code — one of my requests with what IT said (the hub marks it seen). */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const { code } = await params;
  if (!IT_CODE.test(code)) return itJson({ error: "Not found" }, 404);
  return relay(hubFetch(hub, `/tickets/${code}`));
}

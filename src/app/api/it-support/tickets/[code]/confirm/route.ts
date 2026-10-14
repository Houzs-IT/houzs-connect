import { hubFetch, hubFor, itJson, relay } from "@/lib/it-support/hub";
import { IT_CODE } from "@/lib/it-support/shared";

/** POST /api/it-support/tickets/:code/confirm — "Yes, it is fixed": Done -> Closed. */
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const { code } = await params;
  if (!IT_CODE.test(code)) return itJson({ error: "Not found" }, 404);
  return relay(hubFetch(hub, `/tickets/${code}/confirm`, { method: "POST" }));
}

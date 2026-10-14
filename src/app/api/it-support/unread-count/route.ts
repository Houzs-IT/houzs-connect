import { hubFetch, hubFor, relay } from "@/lib/it-support/hub";

/** GET /api/it-support/unread-count — my requests IT has answered since I last opened them. */
export async function GET() {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  return relay(hubFetch(hub, "/tickets/unread-count"));
}

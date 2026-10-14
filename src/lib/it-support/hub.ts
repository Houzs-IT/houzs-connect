import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCurrentMember, type CurrentMember } from "@/lib/current-member";
import { itRelayStatus } from "./shared";

// The only code that talks to the Houzs IT Hub, server to server:
//
//   browser --session--> /api/it-support/* --Bearer key + X-Reporter-Id--> hub
//
// Two rules hold it together:
//   1. The hub key (IT_HUB_API_KEY) never leaves the Worker.
//   2. WHO is reporting comes from the session, never from the request. The hub
//      shows a reporter only their own requests, keyed on X-Reporter-Id, so an id
//      taken from a form field would be everyone's requests one edit away.
//
// The reporter id is the member's email, lower-cased: the ERP org sync gives one
// person a member row per company, and their requests must not split by company.

const TIMEOUT_MS = 20_000;
const UNAVAILABLE = "IT Support is temporarily unavailable. Please try again.";
const NOT_CONNECTED = "IT Support is not connected on this system yet. Please tell IT directly for now.";

export type Hub = { base: string; key: string; reporterId: string; me: CurrentMember };

/** Whether this Worker has the hub's address and key. Cheap: no network, safe on every page render. */
export function itSupportConnected(): boolean {
  const { env } = getCloudflareContext();
  return Boolean(env.IT_HUB_URL?.trim() && env.IT_HUB_API_KEY?.trim());
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

/** The signed-in member plus the hub settings, or the response to send instead. */
export async function hubFor(): Promise<Hub | Response> {
  const me = await getCurrentMember();
  if (!me) return json({ error: "Unauthorized" }, 401);
  const { env } = getCloudflareContext();
  const base = (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) return json({ error: NOT_CONNECTED, code: "NOT_CONFIGURED" }, 501);
  return { base, key, reporterId: me.email.trim().toLowerCase(), me };
}

export function hubFetch(hub: Hub, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${hub.key}`);
  headers.set("X-Reporter-Id", hub.reporterId);
  return fetch(`${hub.base}/api/v1/sys${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/**
 * The hub's JSON answer as ours. A 401 from the hub means OUR key is wrong, which
 * the person at the screen cannot act on and must not look like their own sign-in
 * expiring, so it is reported as unavailable like any other failure.
 */
export async function relay(call: Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call;
  } catch (err) {
    console.warn("[it-support] hub unreachable:", err instanceof Error ? err.message : String(err));
    return json({ error: UNAVAILABLE }, 502);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && body) return json(body, res.status === 201 ? 201 : 200);
  const message = typeof body?.error === "string" ? body.error : "";
  if (itRelayStatus(res.status) === "pass") return json({ error: message || "Request failed" }, res.status);
  console.warn(`[it-support] hub answered ${res.status}: ${message}`);
  return json({ error: UNAVAILABLE }, 502);
}

/** Text fields and files off the browser's form; nothing else is forwarded. */
export async function readForm(req: Request): Promise<{ fields: Record<string, string>; files: File[] } | null> {
  try {
    const form = await req.formData();
    const fields: Record<string, string> = {};
    const files: File[] = [];
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
      else if (k === "files" && v.size > 0) files.push(v);
    }
    return { fields, files };
  } catch {
    return null;
  }
}

export { json as itJson, UNAVAILABLE as IT_UNAVAILABLE };

import type { FlowNode } from "./types";
import { interpolate, type VarContext } from "./vars";

/**
 * Outbound HTTP for the `call_rest_api` node.
 *
 * The owner's migrated Seampify flows use this node to POST into Google Apps
 * Script `/exec` endpoints, which is how rows land in their "HC Delivery
 * Updated" Sheet. Those endpoints are third-party and can be slow, redirected,
 * or simply down — so this helper is built to be *unable* to break a run:
 * every failure path (bad URL, DNS, refused, timeout, non-2xx, unreadable
 * body) resolves to a result object. It never throws, and the caller always
 * continues to the next node. A missed Sheet write must not kill a customer
 * conversation.
 */

/** A hung endpoint must never wedge a run; Workers also cap request lifetime. */
export const REST_TIMEOUT_MS = 10_000;
/** Run logs are stored on the AutomationRun row — keep response bodies bounded. */
export const REST_LOG_SNIPPET_CHARS = 500;
/** Contact attributes are JSON columns rendered in the UI — bound them too. */
export const REST_SAVE_MAX_CHARS = 2_000;

export interface RestCallResult {
  method: string;
  /** Interpolated URL, as actually requested (or attempted). */
  url: string;
  ok: boolean;
  /** HTTP status, or null when the request never produced a response. */
  status: number | null;
  /** Response text, capped for storage on a contact attribute. */
  text: string;
  /** Response text capped much harder, for the run log. */
  snippet: string;
  /** Present only on failure: why the call did not succeed. */
  error?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Headers may arrive as a JSON object (builder textarea), an already-parsed
 * object (imported graphs), or `Key: value` lines (what people actually type).
 * Values are interpolated so a flow can pass e.g. a token attribute.
 */
function parseHeaders(raw: unknown, ctx: VarContext): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      out[k.trim()] = interpolate(String(v), ctx);
    }
  };

  if (raw && typeof raw === "object") {
    take(raw as Record<string, unknown>);
    return out;
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return out;

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        take(parsed as Record<string, unknown>);
        return out;
      }
    } catch {
      // Fall through to line parsing rather than failing the whole call.
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = interpolate(line.slice(idx + 1).trim(), ctx);
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/**
 * Perform the node's HTTP call. `{variable}` / `{{variable}}` placeholders in
 * the URL, headers and body resolve against the same contact context the
 * message nodes use, so a flow can post ref numbers, dates and attributes.
 */
export async function callRestApi(
  data: NonNullable<FlowNode["data"]> | undefined,
  ctx: VarContext,
  opts?: { timeoutMs?: number }
): Promise<RestCallResult> {
  const d = data ?? {};
  const method = String(d.method ?? "POST").trim().toUpperCase() || "POST";
  const url = interpolate(String(d.url ?? ""), ctx);
  const base: RestCallResult = { method, url, ok: false, status: null, text: "", snippet: "" };

  if (!url) return { ...base, error: "no url configured" };

  // Only http(s). No host allowlist — the owner configures these endpoints —
  // but schemes like file:/data: must never be reachable from a flow.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...base, error: "invalid url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ...base, error: `unsupported protocol ${parsed.protocol}` };
  }

  const headers = parseHeaders(d.headers, ctx);
  const rawBody = typeof d.body === "string" ? d.body : "";
  const body = rawBody ? interpolate(rawBody, ctx) : "";
  // GET/HEAD cannot carry a body; sending one makes fetch throw.
  const sendBody = body !== "" && method !== "GET" && method !== "HEAD";
  if (sendBody && !hasHeader(headers, "content-type")) {
    const looksJson = /^[[{]/.test(body.trim());
    headers["Content-Type"] = looksJson ? "application/json" : "text/plain;charset=UTF-8";
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: sendBody ? body : undefined,
      signal: AbortSignal.timeout(opts?.timeoutMs ?? REST_TIMEOUT_MS),
    });
    let text = "";
    try {
      text = await res.text();
    } catch {
      // A truncated/unreadable body must not turn a 200 into a run failure.
      text = "";
    }
    const capped = truncate(text, REST_SAVE_MAX_CHARS);
    return {
      ...base,
      ok: res.ok,
      status: res.status,
      text: capped,
      snippet: truncate(text, REST_LOG_SNIPPET_CHARS),
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ...base,
      error: timedOut
        ? `timeout after ${opts?.timeoutMs ?? REST_TIMEOUT_MS}ms`
        : truncate(err?.message ?? String(e), REST_LOG_SNIPPET_CHARS),
    };
  }
}

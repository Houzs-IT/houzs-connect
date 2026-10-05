import type { FlowNode } from "./types";
import { interpolate, type VarContext } from "./vars";
import { rawFetch } from "@/lib/raw-fetch";

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

/**
 * Worker secrets a header value may name as `{secret:NAME}`. Only these names
 * resolve — a flow is operator-editable JSON and must not be able to read an
 * arbitrary env var into an outbound request. Each one is documented in
 * cloudflare-env.d.ts.
 */
export const REST_HEADER_SECRETS = ["ERP_CALLBACK_KEY"] as const;
export type RestHeaderSecret = (typeof REST_HEADER_SECRETS)[number];
export type RestSecrets = Partial<Record<RestHeaderSecret, string | undefined>>;

const SECRET_REF = /\{secret:([A-Z0-9_]+)\}/g;

/**
 * Replace `{secret:NAME}` in a header value with the Worker secret of that
 * name. Unknown or unset names resolve to "" and are reported, so a missing
 * secret shows up in the run log as missingSecrets rather than as a bare 401
 * from the far end. Never applied to the URL or body: a secret belongs in a
 * header, and interpolating it into a logged body would write it into the run
 * log.
 */
function resolveSecrets(
  value: string,
  secrets: RestSecrets | undefined,
  missing: Set<string>
): string {
  return value.replace(SECRET_REF, (_m, name: string) => {
    const allowed = (REST_HEADER_SECRETS as readonly string[]).includes(name);
    const v = allowed ? secrets?.[name as RestHeaderSecret] : undefined;
    if (!v) missing.add(name);
    return v ?? "";
  });
}

/** A Worker Service Binding (`env.<NAME>.fetch`) to call instead of the network. */
export interface RestFetcher {
  fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
}

/**
 * Hosts whose calls go over a Service Binding instead of the public network,
 * keyed by hostname. The ERP's /api/* is a Workers ROUTE on a Pages origin on
 * the same zone as Connect; three live runs (2026-10-05) saw the plain fetch
 * answered "400, empty body" by something before the ERP worker (its live tail
 * never showed the request), with the runtime fetch AND the
 * global_fetch_strictly_public flag making no difference. A binding is a direct
 * Worker-to-Worker call on the account: no DNS, no zone routing, no edge in the
 * way. The URL is passed through unchanged, so the ERP's router still sees
 * https://erp.houzscentury.com/api/chat-callback.
 */
export type RestBindings = Record<string, RestFetcher | undefined>;

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
  /** `{secret:NAME}` header references that resolved to nothing. */
  missingSecrets?: string[];
  /** Present on a non-2xx: enough response headers to tell WHO answered —
   *  `cf-ray`/`server` mean Cloudflare's edge, `x-request-id` means the ERP
   *  worker itself. Never the request headers (they carry the secret). */
  responseHeaders?: Record<string, string>;
  /** "binding:<host>" when the call went over a Service Binding. */
  via?: string;
}

const DIAG_HEADERS = ["cf-ray", "server", "x-request-id", "content-type", "cf-cache-status"];
function diagHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of DIAG_HEADERS) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Headers may arrive as a JSON object (builder textarea), an already-parsed
 * object (imported graphs), or `Key: value` lines (what people actually type).
 * Values are interpolated so a flow can pass e.g. a token attribute.
 */
function parseHeaders(
  raw: unknown,
  ctx: VarContext,
  secrets: RestSecrets | undefined,
  missing: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  const value = (v: string) => resolveSecrets(interpolate(v, ctx), secrets, missing);
  const take = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      out[k.trim()] = value(String(v));
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
    out[line.slice(0, idx).trim()] = value(line.slice(idx + 1).trim());
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
  opts?: { timeoutMs?: number; secrets?: RestSecrets; bindings?: RestBindings }
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

  const missing = new Set<string>();
  const headers = parseHeaders(d.headers, ctx, opts?.secrets, missing);
  const missingSecrets = missing.size ? { missingSecrets: [...missing] } : {};
  const rawBody = typeof d.body === "string" ? d.body : "";
  const body = rawBody ? interpolate(rawBody, ctx) : "";
  // GET/HEAD cannot carry a body; sending one makes fetch throw.
  const sendBody = body !== "" && method !== "GET" && method !== "HEAD";
  if (sendBody && !hasHeader(headers, "content-type")) {
    const looksJson = /^[[{]/.test(body.trim());
    headers["Content-Type"] = looksJson ? "application/json" : "text/plain;charset=UTF-8";
  }

  // A Service Binding for this host wins over the network (see RestBindings).
  // Otherwise rawFetch, not fetch: Next's wrapper is one more thing between us
  // and the wire (see lib/raw-fetch.ts).
  const binding = opts?.bindings?.[parsed.hostname.toLowerCase()];
  const via = binding ? { via: `binding:${parsed.hostname.toLowerCase()}` } : {};
  const doFetch = binding ? binding.fetch.bind(binding) : rawFetch();
  try {
    const res = await doFetch(url, {
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
      ...missingSecrets,
      ...via,
      ok: res.ok,
      status: res.status,
      text: capped,
      snippet: truncate(text, REST_LOG_SNIPPET_CHARS),
      ...(res.ok ? {} : { error: `HTTP ${res.status}`, responseHeaders: diagHeaders(res) }),
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ...base,
      ...missingSecrets,
      ...via,
      error: timedOut
        ? `timeout after ${opts?.timeoutMs ?? REST_TIMEOUT_MS}ms`
        : truncate(err?.message ?? String(e), REST_LOG_SNIPPET_CHARS),
    };
  }
}

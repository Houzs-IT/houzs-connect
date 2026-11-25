// AI Connector (MCP) — the pure parts: no DB, no network, no Next.
// Pinned by scripts/smoke-mcp.mjs (CI).
//
// Owner 2026-11-25 「connects 也是要」: the same AI Connector Hookka ERP and
// Houzs ERP have. Staff connect Claude / ChatGPT with THEIR OWN Connect login,
// read-only, seeing only what that login sees; the owner approves each person,
// sees every lookup and can disconnect anyone. See src/lib/mcp/server.ts for how
// read-only + own-permissions is enforced, and tasks/HANDOFF.md.

export const MCP_TOKEN_PREFIX = "hcmcp_";
export const MCP_REFRESH_PREFIX = "hcmcpr_";
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 min
// 2026-11-25: 60k → 30k. A reply the AI has to read is the slow part of an answer;
// lists trim whole rows to fit (fitReply) instead of being cut mid-JSON.
export const MAX_RESULT_CHARS = 30_000;
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** The pending "Allow?" request carried across the sign-in page (login/actions.ts). */
export const MCP_RETURN_COOKIE = "hc_mcp_return";
export const LEAK_CLIENT_ID = "mcpc_leak_check";

/** Bearer-only endpoints (no cookies), so any origin may call them — e.g. a browser-based MCP inspector. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

/** Who manages the connector (approve, disconnect, leak check): Connect's top roles. */
export function isMcpAdminRole(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "OWNER";
}

// ── crypto ────────────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PKCE S256 (RFC 7636 §4.2): BASE64URL(SHA256(ASCII(code_verifier))). */
export async function pkceS256(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(buf));
}

/** RFC 7636 §4.1: 43–128 chars of [A-Z a-z 0-9 - . _ ~]. */
export function validCodeVerifier(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** A challenge is a base64url SHA-256: exactly 43 chars. */
export function validCodeChallenge(v: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(v);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────

/** A redirect URI a client may register: https anywhere, http only for loopback; no fragment, no credentials. */
export function validRedirectUri(u: string): boolean {
  if (typeof u !== "string" || u.length > 500) return false;
  try {
    const url = new URL(u);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** A friendly app name for the admin page, from the registered client name. */
export function appLabel(clientName: string | null | undefined): string {
  const n = (clientName ?? "").toLowerCase();
  if (n.includes("leak check")) return "Leak check";
  if (n.includes("claude")) return "Claude";
  if (n.includes("chatgpt") || n.includes("openai")) return "ChatGPT";
  if (n.includes("gemini") || n.includes("google")) return "Gemini";
  return clientName || "AI app";
}

/**
 * The address people use. Each company has its own (chat.houzscentury.com,
 * chat.hookka.com …); the Host header of a Worker request is the routed host,
 * so it is trusted. Plain http only for a computer's own dev server.
 */
export function originFor(host: string | null | undefined, fallbackUrl: string): string {
  const fb = new URL(fallbackUrl);
  const h = (host ?? fb.host).toLowerCase().trim();
  const name = h.replace(/:\d+$/, "");
  const local = name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name.endsWith(".localhost");
  return `${local ? fb.protocol : "https:"}//${h}`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["connect.read"],
    resource_name: "Houzs Connect",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["connect.read"],
  };
}

// ── what the connector may read ───────────────────────────────────────────

/**
 * Never readable through the connector, whatever the person's role: staff-only
 * private chat (Internal), settings (API keys, numbers, roles), sign-in, IT
 * support tickets, the raw APIs and the connector itself.
 */
export const MCP_BLOCKED_PREFIXES = [
  "/internal",
  "/settings",
  "/developers",
  "/security",
  "/login",
  "/session",
  "/api",
  "/mcp",
  "/ai-connector",
  "/it-support",
  "/webhooks",
  "/team",
  "/access",
  "/roles",
];

export type PathDecision = { ok: true; path: string } | { ok: false; reason: string };

/** Normalise and gate one connector path (query string dropped). */
export function classifyPath(raw: unknown): PathDecision {
  if (typeof raw !== "string") return { ok: false, reason: "path must be a string, e.g. /conversations" };
  const p = raw.trim().split("?")[0].split("#")[0];
  if (!p.startsWith("/")) return { ok: false, reason: "Paths start with / — use list_modules / list_endpoints to find one." };
  if (p.length > 200 || /\.\.|\/\/|%|\\|[\s\u0000-\u001f]/.test(p)) return { ok: false, reason: "Invalid path." };
  const clean = p.replace(/\/+$/, "") || "/";
  const lower = clean.toLowerCase();
  if (MCP_BLOCKED_PREFIXES.some((b) => lower === b || lower.startsWith(b + "/"))) {
    return {
      ok: false,
      reason: "That part of Houzs Connect is not available through the AI connector (internal staff chat, settings, sign-in and keys are never shared).",
    };
  }
  return { ok: true, path: clean };
}

/** Match a concrete path against a pattern like /conversations/:id. Returns the params or null. */
export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(b[i])) return null;
      out[a[i].slice(1)] = b[i];
    } else if (a[i] !== b[i]) {
      return null;
    }
  }
  return out;
}

/** Field names removed from every reply: credentials and secrets, never needed to answer a question. */
export const SECRET_KEY = /(password|passwd|secret|token|api_?key|apikey|pin_hash|pin_code|totp|otp_|private_key|signing_key|r2_key|webhook|session|cookie|hash$)/i;

/** Strip credential-shaped fields (any depth). Returns the cleaned value and the names removed. */
export function redactSecrets(v: unknown): { value: unknown; removed: Set<string> } {
  const removed = new Set<string>();
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 40) return null;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x instanceof Date) return x.toISOString();
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) {
          removed.add(k);
          continue;
        }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return x;
  };
  return { value: walk(v, 0), removed };
}

/** Serialise a reply, cut at MAX_RESULT_CHARS, with a note saying so. */
export function capText(json: string, notes: string[] = [], max = MAX_RESULT_CHARS): { text: string; cut: boolean } {
  let out = json;
  let cut = false;
  if (out.length > max) {
    out = out.slice(0, max);
    cut = true;
  }
  const n = [...notes];
  if (cut) n.push(`Reply cut at ${max} characters — narrow it with query parameters (limit, q, status, days).`);
  return { text: (n.length ? n.join(" ") + "\n" : "") + out, cut };
}

/**
 * Drop what carries no information — null, undefined, "", [] and {} — at any
 * depth (array items are kept, only compacted). A missing key reads as "none";
 * the instructions say so.
 */
export function compact(v: unknown, depth = 0): unknown {
  if (depth > 40) return null;
  if (Array.isArray(v)) return v.map((x) => compact(x, depth + 1));
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const c = compact(x, depth + 1);
      if (c === null || c === undefined || c === "") continue;
      if (Array.isArray(c) && c.length === 0) continue;
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return v;
}

/** The longest array in a reply: the value itself, or one of its top-level fields. */
function longestList(v: unknown): { key: string | null; list: unknown[] } | null {
  if (Array.isArray(v)) return { key: null, list: v };
  if (!v || typeof v !== "object") return null;
  let best: { key: string; list: unknown[]; size: number } | null = null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(x) || x.length < 2) continue;
    const size = JSON.stringify(x).length;
    if (!best || size > best.size) best = { key: k, list: x, size };
  }
  return best ? { key: best.key, list: best.list } : null;
}

/**
 * Serialise a reply within MAX_RESULT_CHARS, compacted. Over the cap, a list
 * reply keeps as many WHOLE rows as fit (valid JSON, with a note saying how many
 * of how many); anything else falls back to capText's hard cut.
 */
export function fitReply(value: unknown, notes: string[] = [], max = MAX_RESULT_CHARS): { text: string; cut: boolean; shown?: number } {
  const v = compact(value);
  const head = (n: string[]) => (n.length ? n.join(" ") + "\n" : "");
  const whole = head(notes) + JSON.stringify(v);
  if (whole.length <= max) return { text: whole, cut: false };
  const target = longestList(v);
  if (target && target.list.length > 1) {
    const total = target.list.length;
    const build = (k: number) => {
      const rows = target.list.slice(0, k);
      const body = target.key === null ? rows : { ...(v as Record<string, unknown>), [target.key]: rows };
      const note = `Showing the first ${k} of ${total}${target.key ? ` ${target.key}` : " rows"} to stay under ${max} characters — narrow it with query parameters (q, status, days, limit, offset).`;
      return head([...notes, note]) + JSON.stringify(body);
    };
    let lo = 0;
    let hi = total - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (build(mid).length <= max) lo = mid;
      else hi = mid - 1;
    }
    const text = build(lo);
    if (lo > 0 && text.length <= max) return { text, cut: true, shown: lo };
  }
  const c = capText(JSON.stringify(v), notes, max);
  return { text: c.text, cut: c.cut };
}

/** Money / people field names — the leak check reports where these reach a staff account (names only). */
export const SENSITIVE_KEY = /(amount|price|total|balance|deposit|paid|payment|salary|cost|margin|commission|phone|email|address|ic_?no|nric|bank|ocr)/i;

/** Every key name in a JSON value (any depth, capped). */
export function jsonKeys(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || out.size > 2000) return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) jsonKeys(x, out, depth + 1);
  } else if (v && typeof v === "object" && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      jsonKeys(x, out, depth + 1);
    }
  }
  return out;
}

/** A bounded integer from a query value. */
export function intParam(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/** A trimmed string query value, capped. */
export function strParam(v: unknown, max = 100): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).trim().slice(0, max);
}

/** Escape text for the server-rendered "Allow?" page. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

// ERP-account auth for Houzs Connect.
//
// Staff log in with their REAL Houzs ERP email + password. Connect shares the
// ERP's Supabase database, so it verifies credentials straight against
// `public.users` (the ERP's user table) — same PBKDF2 scheme the ERP uses
// (services/auth.ts). No ERP-side change, no second password to manage.
//
// The session is a stateless signed cookie (HMAC-SHA256 over memberId.expiry),
// so there's no session table to keep. SESSION_SECRET must be set (env/secret).

// ── PBKDF2 (ported verbatim from the ERP so hashes verify identically) ──
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const KEY_BITS = 256;

const enc = (s: string): BufferSource => new TextEncoder().encode(s) as BufferSource;

function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Verify a password against the ERP's `salt$hash` (both base64) format. */
export async function verifyErpPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes("$")) return false;
  const [saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64) return false;
  const salt = b64ToBytes(saltB64);
  const expected = b64ToBytes(hashB64);
  const key = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    KEY_BITS
  );
  const got = new Uint8Array(bits);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

// ── Stateless signed session (HMAC-SHA256) ──
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc(data));
  return bytesToB64Url(new Uint8Array(sig));
}

/** token = "<memberId>.<expiryMs>.<hmac>" — memberId is a cuid (no dots). */
export async function signSession(memberId: string, secret: string): Promise<string> {
  const payload = `${memberId}.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [memberId, expStr, sig] = parts;
  const payload = `${memberId}.${expStr}`;
  const expected = await hmac(secret, payload);
  // constant-time-ish compare
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  if (!Number.isFinite(Number(expStr)) || Number(expStr) < Date.now()) return null;
  return memberId;
}

/** Map an ERP role name to Connect's Role enum (best-effort by keyword). */
export function roleFromErp(erpRole: string | null | undefined): "OWNER" | "ADMIN" | "MANAGER" | "AGENT" | "SALES" | "DRIVER" | "VIEWER" {
  const r = (erpRole ?? "").toLowerCase();
  if (r.includes("owner")) return "OWNER";
  if (r.includes("admin") || r.includes("it")) return "ADMIN";
  if (r.includes("manager") || r.includes("director") || r.includes("head")) return "MANAGER";
  if (r.includes("driver")) return "DRIVER";
  if (r.includes("sales")) return "SALES";
  if (r.includes("view")) return "VIEWER";
  return "AGENT";
}

export const SESSION_COOKIE = "hc_session";

// export_excel files (AI Connector round 3, owner 2026-11-26).
//
// Stored in R2 (the FILES bucket) under mcp-exports/<sha256 of the link token>.xlsx.
// The download link carries the random token, so a bucket listing never reveals
// a link; the link works for EXPORT_TTL_MS, checked on download
// (src/app/api/mcp/export/[token]/route.ts). Objects older than a day are swept
// on the next export. Anyone holding the link can download it inside those 15
// minutes — the same trust as a signed URL.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { randomToken, sha256Hex } from "./core";
import { EXPORT_TTL_MS } from "./round3";
import { XLSX_TYPE } from "./xlsx";

export const EXPORT_PREFIX = "mcp-exports/";
export const EXPORT_TOKEN = /^[A-Za-z0-9_-]{32}$/;

type Bucket = {
  put: (key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => Promise<unknown>;
  get: (key: string) => Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null>;
  list: (opts: { prefix: string; limit?: number }) => Promise<{ objects: { key: string; uploaded: Date }[] }>;
  delete: (keys: string | string[]) => Promise<unknown>;
};

export function exportBucket(): Bucket | null {
  try {
    return ((getCloudflareContext().env as unknown as { FILES?: Bucket }).FILES ?? null) as Bucket | null;
  } catch {
    return null;
  }
}

export const exportKey = async (token: string) => `${EXPORT_PREFIX}${await sha256Hex(token)}.xlsx`;

/** Store one export; returns the 15-minute link. `defer` runs the sweep after the answer. */
export async function storeExport(
  bytes: Uint8Array,
  fileName: string,
  who: { memberId: string; email: string },
  origin: string,
  defer?: (p: Promise<unknown>) => void
): Promise<{ url: string; expiresAt: string }> {
  const bucket = exportBucket();
  if (!bucket) throw new Error("Excel export storage is not available here.");
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS).toISOString();
  await bucket.put(await exportKey(token), bytes, {
    httpMetadata: { contentType: XLSX_TYPE },
    customMetadata: { expiresAt, memberId: who.memberId, email: who.email.toLowerCase(), fileName },
  });
  const sweep = (async () => {
    const old = Date.now() - 24 * 3600_000;
    const listed = await bucket.list({ prefix: EXPORT_PREFIX, limit: 200 });
    const stale = listed.objects.filter((o) => new Date(o.uploaded).getTime() < old).map((o) => o.key);
    if (stale.length) await bucket.delete(stale);
  })().catch((e) => console.warn("[mcp] export sweep failed:", e instanceof Error ? e.message : String(e)));
  if (defer) defer(sweep);
  return { url: `${origin}/api/mcp/export/${token}`, expiresAt };
}

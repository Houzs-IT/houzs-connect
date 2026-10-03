import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureSettingsExtras } from "@/db/ensure-settings-extras";

/*
  API keys for other systems (connect.api_key, migration 0013). The key is
  shown once when created; only its SHA-256 is stored, plus the first
  characters so a list can tell keys apart. A request authenticates with
  `Authorization: Bearer hc_…` and acts as the key's company.
*/

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "hc_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ApiKeyRow = { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; createdBy: string | null };

export async function listKeys(companyId: string): Promise<ApiKeyRow[]> {
  const db = getDb();
  await ensureSettingsExtras(db);
  const rows = (await db.execute(sql`
    select k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at, m.name as created_by
    from connect.api_key k left join connect.member m on m.id = k.created_by_member_id
    where k.company_id = ${companyId}
    order by k.revoked_at nulls first, k.created_at desc
  `)) as unknown as { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null; created_by: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: new Date(r.created_at),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    createdBy: r.created_by,
  }));
}

/** Make a key. The full value is returned here and never again. */
export async function createKey(companyId: string, name: string, memberId: string): Promise<string> {
  const db = getDb();
  await ensureSettingsExtras(db);
  const key = randomKey();
  await db.execute(sql`
    insert into connect.api_key (id, company_id, name, prefix, hash, created_by_member_id)
    values (${createId()}, ${companyId}, ${name}, ${key.slice(0, 10)}, ${await sha256(key)}, ${memberId})
  `);
  return key;
}

export async function revokeKey(companyId: string, id: string): Promise<void> {
  const db = getDb();
  await ensureSettingsExtras(db);
  await db.execute(sql`
    update connect.api_key set revoked_at = now() where id = ${id} and company_id = ${companyId} and revoked_at is null
  `);
}

/** The company a request's key belongs to, or null. Marks the key used. */
export async function authenticate(req: Request): Promise<{ companyId: string; keyId: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("hc_") || key.length < 20) return null;
  const db = getDb();
  await ensureSettingsExtras(db);
  const rows = (await db.execute(sql`
    update connect.api_key set last_used_at = now()
    where hash = ${await sha256(key)} and revoked_at is null
    returning id, company_id
  `)) as unknown as { id: string; company_id: string }[];
  return rows[0] ? { companyId: rows[0].company_id, keyId: rows[0].id } : null;
}

export const unauthorized = () =>
  Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer hc_…" }, { status: 401 });

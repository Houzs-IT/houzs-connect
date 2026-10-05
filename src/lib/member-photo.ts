import { cache } from "react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member, memberPhoto } from "@/db/schema";
import { ensureMemberPhotoTable } from "@/db/ensure-member-photo";
import { bypassReadCache } from "@/db/fresh";
import { getCurrentMember } from "@/lib/current-member";

/*
  Staff profile photos (Settings → My profile).

  Stored per PERSON — lower-cased email — in connect.member_photo, because the
  org sync gives one person a member row per company. Served for a MEMBER id by
  app/api/member-photo/[id], which maps the id back to the email. Each URL
  carries the photo's updated_at as `?v=`, so the browser can keep it for a
  year and a new photo is simply a new URL.

  Every read here swallows its errors and answers "no photo": a missing table
  or a bad moment in Postgres costs initials, never a page.
*/

export function photoKey(email: string): string {
  return email.trim().toLowerCase();
}

export function photoSrc(memberId: string, updatedAt: Date): string {
  return `/api/member-photo/${encodeURIComponent(memberId)}?v=${updatedAt.getTime()}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * memberId → photo URL, for those of `memberIds` whose person has a photo; the
 * rest are simply absent. One query whatever the count.
 *
 * `fresh` skips Hyperdrive's read cache (db/fresh.ts). Use it only for the
 * viewer's own photo: right after a change they expect to see it everywhere,
 * while a colleague's new photo turning up a minute late is harmless.
 */
export async function photoSrcs(
  memberIds: (string | null | undefined)[],
  opts: { fresh?: boolean } = {}
): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds.filter((id): id is string => !!id))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const db = getDb();
    await ensureMemberPhotoTable(db);
    const rows = await db
      .select({ id: member.id, updatedAt: memberPhoto.updatedAt })
      .from(member)
      .innerJoin(memberPhoto, eq(memberPhoto.email, sql`lower(trim(${member.email}))`))
      .where(and(inArray(member.id, ids), opts.fresh ? bypassReadCache() : undefined));
    for (const r of rows) out.set(r.id, photoSrc(r.id, r.updatedAt));
  } catch (e) {
    console.warn("[member-photo] lookup failed:", e);
  }
  return out;
}

/** The signed-in member's own photo URL, or null. Memoised per request. */
export const getMyPhotoSrc = cache(async (): Promise<string | null> => {
  const me = await getCurrentMember();
  if (!me) return null;
  return (await photoSrcs([me.id], { fresh: true })).get(me.id) ?? null;
});

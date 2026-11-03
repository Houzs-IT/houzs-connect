"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { deletePhoto, photoKey, savePhoto } from "@/lib/member-photo";
import type { PhotoResult } from "@/lib/member-photo-limits";
import { isAdminRole } from "@/lib/permissions";

/*
  An owner or admin setting someone else's profile photo from Settings → Team
  — the same people who may open that page (team/actions.ts `manager()`).
  Everyone can still change their own on My profile.
*/

/** The person's key, when the caller may change their photo and they exist. */
async function target(email: string): Promise<{ key: string; byId: string } | PhotoResult> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "signin" };
  if (!isAdminRole(me.role)) return { ok: false, error: "forbidden" };
  const key = photoKey(email);
  if (!key) return { ok: false, error: "forbidden" };
  // Any company: Team lists people across all of them.
  const who = await getDb().query.member.findFirst({
    where: sql`lower(trim(${member.email})) = ${key}`,
    columns: { id: true },
  });
  return who ? { key, byId: me.id } : { ok: false, error: "forbidden" };
}

export async function uploadPhotoFor(formData: FormData): Promise<PhotoResult> {
  const t = await target(String(formData.get("email") ?? ""));
  if ("ok" in t) return t;
  const r = await savePhoto(t.key, formData.get("photo"), t.byId);
  // Their photo is in the rail and lists on every page, the admin's own included.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function removePhotoFor(email: string): Promise<PhotoResult> {
  const t = await target(email);
  if ("ok" in t) return t;
  const r = await deletePhoto(t.key);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

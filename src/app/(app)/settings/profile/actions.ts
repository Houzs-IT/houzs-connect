"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memberPhoto } from "@/db/schema";
import { ensureMemberPhotoTable } from "@/db/ensure-member-photo";
import { getCurrentMember } from "@/lib/current-member";
import { bytesToBase64, photoKey } from "@/lib/member-photo";
import { PHOTO_UPLOAD_MAX_BYTES, type PhotoResult } from "@/lib/member-photo-limits";

/*
  The signed-in person's own profile photo — nobody can set someone else's.
  Stored per person (lib/member-photo.ts), so it shows in every company they
  work in.
*/

/** A JPEG starts FF D8 FF. The picker re-encodes whatever was chosen into one,
 *  so anything else did not come from Connect's own page. */
function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export async function uploadMyPhoto(formData: FormData): Promise<PhotoResult> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "signin" };

  const file = formData.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > PHOTO_UPLOAD_MAX_BYTES) return { ok: false, error: "size" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) return { ok: false, error: "type" };

  const row = { data: bytesToBase64(bytes), updatedAt: new Date(), updatedBy: me.id };
  try {
    const db = getDb();
    await ensureMemberPhotoTable(db);
    await db
      .insert(memberPhoto)
      .values({ email: photoKey(me.email), ...row })
      .onConflictDoUpdate({ target: memberPhoto.email, set: row });
  } catch (e) {
    console.error("[member-photo] save failed:", e);
    return { ok: false, error: "save" };
  }
  // The rail and the top bar show it on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMyPhoto(): Promise<PhotoResult> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "signin" };
  try {
    const db = getDb();
    await ensureMemberPhotoTable(db);
    await db.delete(memberPhoto).where(eq(memberPhoto.email, photoKey(me.email)));
  } catch (e) {
    console.error("[member-photo] remove failed:", e);
    return { ok: false, error: "save" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

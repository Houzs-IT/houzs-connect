"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { deletePhoto, savePhoto } from "@/lib/member-photo";
import type { PhotoResult } from "@/lib/member-photo-limits";

/*
  The signed-in person's own profile photo. Admins change other people's from
  Settings → Team (team/photo-actions.ts). Stored per person
  (lib/member-photo.ts), so it shows in every company they work in.
*/

export async function uploadMyPhoto(formData: FormData): Promise<PhotoResult> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "signin" };
  const r = await savePhoto(me.email, formData.get("photo"), me.id);
  // The rail and the top bar show it on every page.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function removeMyPhoto(): Promise<PhotoResult> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "signin" };
  const r = await deletePhoto(me.email);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

"use server";

// The business profile customers see for a number: photo, about line,
// description, address, email, websites, category — and display-name changes,
// which Meta reviews. Owner/admin only, like everything else on this page.

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { recordNumberEvent } from "@/lib/whatsapp/number-events";
import { getNumber, wabaConfig } from "@/lib/whatsapp/numbers";
import {
  getBusinessProfile,
  profileProblem,
  requestDisplayName,
  updateBusinessProfile,
  uploadProfilePicture,
  type BusinessProfile,
  type ProfileInput,
} from "@/lib/whatsapp/profile";

async function requireAdmin(): Promise<boolean> {
  const me = await getCurrentMember();
  return !!me && (me.role === "OWNER" || me.role === "ADMIN");
}

export interface ProfileResult {
  ok: boolean;
  error?: string;
  /** Read back from Meta after the change, so the form shows what customers see. */
  profile?: BusinessProfile;
  newDisplayName?: string | null;
  newNameStatus?: string | null;
}

const DENIED: ProfileResult = {
  ok: false,
  error: "Only an owner or admin can change what customers see about the business.",
};
const UNCONFIGURED: ProfileResult = {
  ok: false,
  error: "WhatsApp is not connected — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on this Worker.",
};

const PHOTO_TYPES = ["image/jpeg", "image/png"];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export async function loadBusinessProfile(phoneId: string): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const res = await getBusinessProfile(cfg, phoneId);
  return res.ok ? { ok: true, profile: res.data } : { ok: false, error: res.error };
}

/** Save the text fields, then read the profile back from Meta. */
export async function saveBusinessProfile(
  phoneId: string,
  input: ProfileInput
): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;

  const clean: ProfileInput = {
    about: input.about.trim(),
    address: input.address.trim(),
    description: input.description.trim(),
    email: input.email.trim(),
    websites: input.websites.map((w) => w.trim()).filter(Boolean),
    vertical: input.vertical,
  };
  const problem = profileProblem(clean);
  if (problem) return { ok: false, error: problem };

  const res = await updateBusinessProfile(cfg, phoneId, clean);
  const result: ProfileResult = res.ok ? { ok: true } : { ok: false, error: res.error };
  if (res.ok) {
    const fresh = await getBusinessProfile(cfg, phoneId);
    if (fresh.ok) result.profile = fresh.data;
  }
  await recordNumberEvent("profile", phoneId, result, {
    fields: Object.keys(clean).filter((k) => {
      const v = clean[k as keyof ProfileInput];
      return Array.isArray(v) ? v.length > 0 : !!v;
    }),
  });
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
}

/** Upload a new profile photo (JPEG or PNG, up to 5 MB) and set it. */
export async function uploadBusinessPhoto(formData: FormData): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;

  const phoneId = String(formData.get("phoneId") ?? "");
  const file = formData.get("photo");
  if (!phoneId) return { ok: false, error: "Which number is this photo for?" };
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "Choose a photo first." };
  if (!PHOTO_TYPES.includes(file.type)) {
    return { ok: false, error: "The photo must be a JPEG or PNG." };
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return { ok: false, error: "The photo must be 5 MB or smaller." };
  }
  const name = typeof (file as File).name === "string" ? (file as File).name : "profile.jpg";

  const uploaded = await uploadProfilePicture(cfg, await file.arrayBuffer(), file.type, name);
  let result: ProfileResult;
  if (!uploaded.ok) {
    result = { ok: false, error: uploaded.error };
  } else {
    const set = await updateBusinessProfile(cfg, phoneId, { profilePictureHandle: uploaded.data });
    result = set.ok ? { ok: true } : { ok: false, error: set.error };
    if (set.ok) {
      const fresh = await getBusinessProfile(cfg, phoneId);
      if (fresh.ok) result.profile = fresh.data;
    }
  }
  await recordNumberEvent("profile-photo", phoneId, result, { bytes: file.size, type: file.type });
  if (result.ok) revalidatePath("/settings/numbers");
  return result;
}

/** Submit a new display name for Meta's review. */
export async function submitDisplayName(phoneId: string, name: string): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 3) return { ok: false, error: "The display name needs at least 3 characters." };

  const res = await requestDisplayName(cfg, phoneId, clean);
  const result: ProfileResult = res.ok ? { ok: true } : { ok: false, error: res.error };
  if (res.ok) {
    const fresh = await getNumber(cfg, phoneId);
    if (fresh.ok) {
      result.newDisplayName = fresh.data.newDisplayName;
      result.newNameStatus = fresh.data.newNameStatus;
    }
  }
  await recordNumberEvent("display-name", phoneId, result, { requested: clean });
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
}

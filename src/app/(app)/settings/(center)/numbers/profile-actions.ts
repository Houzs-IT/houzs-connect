"use server";

// The business profile customers see for a number: photo, about line,
// description, address, email, websites, category — and display-name changes,
// which Meta reviews. Owner/admin only, like everything else on this page.
//
// Every attempt is written to System Logs (source 'numbers'), including the ones
// stopped before reaching Meta: "I pressed Save and nothing happened" had no
// trace when a save was refused here, and on 2026-09-14 that was the whole
// report. `stage` in the row says where it ended — "read" (Meta did not return
// the current profile), "connect" (stopped here, reason given) or "meta" (sent,
// with Meta's answer).

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { recordNumberEvent } from "@/lib/whatsapp/number-events";
import { getNumber, wabaConfig } from "@/lib/whatsapp/numbers";
import {
  getBusinessProfile,
  requestDisplayName,
  updateBusinessProfile,
  uploadProfilePicture,
} from "@/lib/whatsapp/profile";
import {
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  profileChanges,
  profileProblem,
  type BusinessProfile,
  type ProfileInput,
} from "@/lib/whatsapp/profile-limits";
import { isAdminRole } from "@/lib/permissions";

async function requireAdmin(): Promise<boolean> {
  const me = await getCurrentMember();
  return !!me && isAdminRole(me.role);
}

export interface ProfileResult {
  ok: boolean;
  error?: string;
  /** Read back from Meta after the change, so the form shows what customers see. */
  profile?: BusinessProfile;
  /** The fields a save sent to Meta; empty when nothing differed from Meta's copy. */
  changed?: (keyof ProfileInput)[];
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

export async function loadBusinessProfile(phoneId: string): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const res = await getBusinessProfile(cfg, phoneId);
  if (res.ok) return { ok: true, profile: res.data };
  const result: ProfileResult = { ok: false, error: res.error };
  await recordNumberEvent("profile-load", phoneId, result, { stage: "read" });
  return result;
}

/**
 * Save the text fields that changed, then read the profile back from Meta.
 *
 * Compared with what Meta holds NOW rather than with what the form loaded — the
 * editor may have been open for an hour — and only the differences are sent.
 */
export async function saveBusinessProfile(
  phoneId: string,
  input: ProfileInput
): Promise<ProfileResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;

  const current = await getBusinessProfile(cfg, phoneId);
  if (!current.ok) {
    const result: ProfileResult = {
      ok: false,
      error: `Meta did not return the current profile, so nothing was sent: ${current.error}`,
    };
    await recordNumberEvent("profile", phoneId, result, { stage: "read" });
    return result;
  }

  const changes = profileChanges(current.data, input);
  const changed = Object.keys(changes) as (keyof ProfileInput)[];
  if (changed.length === 0) {
    const result: ProfileResult = { ok: true, changed, profile: current.data };
    await recordNumberEvent("profile", phoneId, result, { stage: "connect", fields: changed });
    return result;
  }
  const problem = profileProblem(changes);
  if (problem) {
    const result: ProfileResult = { ok: false, error: problem };
    await recordNumberEvent("profile", phoneId, result, { stage: "connect", fields: changed });
    return result;
  }

  const res = await updateBusinessProfile(cfg, phoneId, changes);
  const result: ProfileResult = res.ok ? { ok: true, changed } : { ok: false, error: res.error };
  if (res.ok) {
    const fresh = await getBusinessProfile(cfg, phoneId);
    if (fresh.ok) result.profile = fresh.data;
  }
  await recordNumberEvent("profile", phoneId, result, { stage: "meta", fields: changed });
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

  const refuse = async (error: string, extra: Record<string, unknown>): Promise<ProfileResult> => {
    const result: ProfileResult = { ok: false, error };
    await recordNumberEvent("profile-photo", phoneId, result, { stage: "connect", ...extra });
    return result;
  };
  if (!(file instanceof Blob) || file.size === 0) return refuse("Choose a photo first.", {});
  if (!PHOTO_TYPES.includes(file.type)) {
    return refuse("The photo must be a JPEG or PNG.", { type: file.type });
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return refuse("The photo must be 5 MB or smaller.", { bytes: file.size });
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
  await recordNumberEvent("profile-photo", phoneId, result, { stage: "meta", bytes: file.size, type: file.type });
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
  await recordNumberEvent("display-name", phoneId, result, { stage: "meta", requested: clean });
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
}

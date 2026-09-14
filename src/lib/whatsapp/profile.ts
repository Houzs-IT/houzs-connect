// What a customer sees about us in WhatsApp: the business profile of a number.
//
// Photo, about line, description, address, email, websites and category live on
// the phone number at Meta, not in Connect. Before this the only place to set
// them was WhatsApp Manager, so each company's numbers showed whatever was typed
// at signup — or nothing. The display name is separate: it is reviewed by Meta,
// and a change only takes effect after approval AND a re-registration.
//
// Docs:
//   profile       https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles
//   display name  https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
//   photo upload  https://developers.facebook.com/docs/graph-api/guides/upload (Resumable Upload API)

import { graph, type GraphResult } from "./graph";
import type { WabaConfig } from "./numbers";
import type { BusinessProfile, ProfileInput } from "./profile-limits";

export {
  PROFILE_LIMITS,
  profileProblem,
  VERTICALS,
  type BusinessProfile,
  type ProfileInput,
} from "./profile-limits";

// v23.0 to match cloud-api.ts and numbers.ts.
const GRAPH = "https://graph.facebook.com/v23.0";

interface RawProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profile_picture_url?: string;
}

export async function getBusinessProfile(
  cfg: WabaConfig,
  phoneId: string
): Promise<GraphResult<BusinessProfile>> {
  const res = await graph<{ data?: RawProfile[] }>(
    `${GRAPH}/${phoneId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    cfg.token
  );
  if (!res.ok) return res;
  const p = res.data.data?.[0] ?? {};
  return {
    ok: true,
    data: {
      about: p.about ?? "",
      address: p.address ?? "",
      description: p.description ?? "",
      email: p.email ?? "",
      websites: p.websites ?? [],
      vertical: p.vertical ?? "",
      profilePictureUrl: p.profile_picture_url ?? null,
    },
  };
}

/** Write the text fields (and, when given, a photo handle) to the number. */
export async function updateBusinessProfile(
  cfg: WabaConfig,
  phoneId: string,
  p: Partial<ProfileInput> & { profilePictureHandle?: string }
): Promise<GraphResult<{ success?: boolean }>> {
  const body: Record<string, unknown> = { messaging_product: "whatsapp" };
  if (p.about !== undefined) body.about = p.about;
  if (p.address !== undefined) body.address = p.address;
  if (p.description !== undefined) body.description = p.description;
  if (p.email !== undefined) body.email = p.email;
  if (p.websites !== undefined) body.websites = p.websites;
  if (p.vertical) body.vertical = p.vertical;
  if (p.profilePictureHandle) body.profile_picture_handle = p.profilePictureHandle;
  return graph(`${GRAPH}/${phoneId}/whatsapp_business_profile`, cfg.token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The Meta app the token belongs to. The photo upload is an app-level API, and
 * asking the token is what keeps this from needing one more secret to configure
 * (WHATSAPP_APP_ID still wins when it is set).
 */
async function appId(cfg: WabaConfig): Promise<GraphResult<string>> {
  if (process.env.WHATSAPP_APP_ID) return { ok: true, data: process.env.WHATSAPP_APP_ID };
  const res = await graph<{ id?: string }>(`${GRAPH}/app`, cfg.token);
  if (!res.ok) return res;
  return res.data.id ? { ok: true, data: res.data.id } : { ok: false, error: "Meta did not say which app this token belongs to." };
}

/**
 * Upload a photo and get back the handle the profile takes.
 *
 * Two hops, per the Resumable Upload API: open a session on the app, then send
 * the bytes to it with `Authorization: OAuth` (not Bearer — the docs are
 * explicit) and `file_offset: 0`. The handle `h` is what
 * `profile_picture_handle` accepts.
 */
export async function uploadProfilePicture(
  cfg: WabaConfig,
  bytes: ArrayBuffer,
  mimeType: string,
  fileName: string
): Promise<GraphResult<string>> {
  const app = await appId(cfg);
  if (!app.ok) return app;

  const params = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
  });
  const session = await graph<{ id?: string }>(`${GRAPH}/${app.data}/uploads?${params}`, cfg.token, {
    method: "POST",
  });
  if (!session.ok) return session;
  if (!session.data.id) return { ok: false, error: "Meta did not open an upload session." };

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${session.data.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${cfg.token}`, file_offset: "0" },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? "Network error while uploading the photo to Meta." };
  }
  const text = await res.text().catch(() => "");
  let json: { h?: string; error?: { error_user_msg?: string; message?: string } } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // fall through with the raw text below
  }
  if (!res.ok || !json.h) {
    return {
      ok: false,
      error: json.error?.error_user_msg ?? json.error?.message ?? (text.slice(0, 300) || `Meta returned HTTP ${res.status}.`),
    };
  }
  return { ok: true, data: json.h };
}

/**
 * Submit a new display name for Meta's review.
 *
 * Not live until approved. After approval the number must be REGISTERED AGAIN
 * (with its PIN) within 14 days for the new name to show, and Meta allows 10
 * changes per 30 days.
 */
export async function requestDisplayName(
  cfg: WabaConfig,
  phoneId: string,
  name: string
): Promise<GraphResult<{ success?: boolean }>> {
  return graph(`${GRAPH}/${phoneId}`, cfg.token, {
    method: "POST",
    body: JSON.stringify({ new_display_name: name }),
  });
}

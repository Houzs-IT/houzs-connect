"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import {
  activePhoneNumberId,
  addNumber,
  deregisterNumber,
  listNumbers,
  registerNumber,
  requestCode,
  verifyCode,
  wabaConfig,
  wabaIdForLinks,
  whatsAppManagerNumbersUrl,
  type CodeMethod,
  type WabaNumber,
} from "@/lib/whatsapp/numbers";

/**
 * Only OWNER and ADMIN.
 *
 * A higher bar than templates deliberately: everything in this file changes the
 * identity the company messages customers from, and `deregister` can take the
 * live number offline mid-day. An AGENT has no business here.
 */
async function requireAdmin(): Promise<boolean> {
  const me = await getCurrentMember();
  return !!me && (me.role === "OWNER" || me.role === "ADMIN");
}

export interface NumbersView {
  /** False when WHATSAPP_WABA_ID / WHATSAPP_TOKEN are not set (DEMO). */
  configured: boolean;
  /** False when the caller is not an owner/admin. */
  permitted: boolean;
  numbers: WabaNumber[];
  /** The id this app sends from, whether or not it is on the list above. */
  activeId: string | null;
  /** Deep link to WhatsApp Manager — the only place a number can be deleted. */
  managerUrl: string | null;
  error?: string;
}

/** Every number on the WABA, with the active sender marked. */
export async function fetchNumbers(): Promise<NumbersView> {
  const activeId = activePhoneNumberId();
  const wabaId = wabaIdForLinks();
  const managerUrl = wabaId ? whatsAppManagerNumbersUrl(wabaId) : null;
  if (!(await requireAdmin())) {
    return {
      configured: true,
      permitted: false,
      numbers: [],
      activeId: null,
      managerUrl: null,
    };
  }
  const cfg = wabaConfig();
  if (!cfg) {
    return { configured: false, permitted: true, numbers: [], activeId, managerUrl };
  }
  const res = await listNumbers(cfg);
  if (!res.ok) {
    return {
      configured: true,
      permitted: true,
      numbers: [],
      activeId,
      managerUrl,
      error: res.error,
    };
  }
  return { configured: true, permitted: true, numbers: res.data, activeId, managerUrl };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set by addPhoneNumber so the UI can carry on into verification. */
  id?: string;
}

const DENIED: ActionResult = {
  ok: false,
  error: "Only an owner or admin can change the company's WhatsApp numbers.",
};
const UNCONFIGURED: ActionResult = {
  ok: false,
  error: "WhatsApp is not connected — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on this Worker.",
};

/** Step 1 — put a new number on the WABA. */
export async function addPhoneNumber(input: {
  cc: string;
  phoneNumber: string;
  verifiedName: string;
}): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;

  // Meta wants digits only. A pasted "+60 11-1110 8822" is the normal way a
  // person types a phone number and would otherwise come back as an opaque
  // "(#100) Invalid parameter" several seconds later.
  const cc = input.cc.replace(/\D/g, "");
  const national = input.phoneNumber.replace(/\D/g, "").replace(/^0+/, "");
  const name = input.verifiedName.trim();
  if (!cc) return { ok: false, error: "Country code is required (60 for Malaysia)." };
  if (!national) return { ok: false, error: "Enter the phone number." };
  if (!name) return { ok: false, error: "Enter the display name customers will see." };

  const res = await addNumber(cfg, { cc, phoneNumber: national, verifiedName: name });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/settings/numbers");
  return { ok: true, id: res.data.id };
}

/** Step 2 — send the ownership code to the number. */
export async function sendVerificationCode(
  phoneId: string,
  method: CodeMethod
): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const res = await requestCode(cfg, phoneId, method);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/settings/numbers");
  return { ok: true };
}

/** Step 3 — submit the code that arrived. */
export async function confirmVerificationCode(
  phoneId: string,
  code: string
): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const digits = code.replace(/\D/g, "");
  if (!digits) return { ok: false, error: "Enter the code Meta sent." };
  const res = await verifyCode(cfg, phoneId, digits);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/settings/numbers");
  return { ok: true };
}

/** Step 4 — register for Cloud API. Until this runs, the number cannot send. */
export async function registerForCloudApi(
  phoneId: string,
  pin: string
): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  const digits = pin.replace(/\D/g, "");
  // Checked here rather than left to Meta: a 5-digit PIN comes back as a
  // generic parameter error, and the person reading it has no way to know the
  // length was the problem.
  if (digits.length !== 6) {
    return { ok: false, error: "The two-step PIN must be exactly six digits." };
  }
  const res = await registerNumber(cfg, phoneId, digits);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/settings/numbers");
  return { ok: true };
}

/**
 * Release a number from Cloud API.
 *
 * Refused for the number this app is currently sending from — deregistering it
 * stops every campaign, automation and inbox reply at once, and doing that by
 * misclicking a row is not a thing this page should permit. Point
 * WHATSAPP_PHONE_NUMBER_ID somewhere else first.
 */
export async function releaseFromCloudApi(phoneId: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;
  if (phoneId === activePhoneNumberId()) {
    return {
      ok: false,
      error:
        "This is the number the app sends from. Point WHATSAPP_PHONE_NUMBER_ID at another number before releasing it.",
    };
  }
  const res = await deregisterNumber(cfg, phoneId);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/settings/numbers");
  return { ok: true };
}

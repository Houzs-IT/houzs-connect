"use server";

import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { channelForNumber, loadRoutingTable } from "@/lib/whatsapp/channels";
import { assignNumber, type AssignTarget } from "@/lib/whatsapp/number-assignment";
import { recordNumberEvent } from "@/lib/whatsapp/number-events";
import {
  activePhoneNumberId,
  addNumber,
  deregisterNumber,
  getNumber,
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

/** Where a number's messages go, as the page shows it. */
export interface NumberAssignment {
  companyId: string;
  companyName: string;
  /** Reached only through the default sender setting, not written on a channel. */
  legacy: boolean;
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
  /** Keyed by phone number id; null = not assigned, so its messages are refused. */
  assignments: Record<string, NumberAssignment | null>;
  /** Active companies a number can be assigned to. */
  companies: { id: string; name: string }[];
  error?: string;
}

/** Every number on the WABA, with the active sender and each number's company. */
export async function fetchNumbers(): Promise<NumbersView> {
  const activeId = activePhoneNumberId();
  const wabaId = wabaIdForLinks();
  const managerUrl = wabaId ? whatsAppManagerNumbersUrl(wabaId) : null;
  const empty = { assignments: {}, companies: [] };
  if (!(await requireAdmin())) {
    return {
      configured: true,
      permitted: false,
      numbers: [],
      activeId: null,
      managerUrl: null,
      ...empty,
    };
  }
  const cfg = wabaConfig();
  if (!cfg) {
    return { configured: false, permitted: true, numbers: [], activeId, managerUrl, ...empty };
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
      ...empty,
    };
  }

  const db = getDb();
  const [routing, companies] = await Promise.all([
    loadRoutingTable(db),
    db.query.company.findMany({
      columns: { id: true, name: true },
      where: eq(company.active, true),
      orderBy: asc(company.createdAt),
    }),
  ]);
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const assignments: Record<string, NumberAssignment | null> = {};
  for (const n of res.data) {
    const hit = channelForNumber(routing, n.id);
    assignments[n.id] = hit
      ? {
          companyId: hit.channel.companyId,
          companyName: nameOf.get(hit.channel.companyId) ?? "an inactive company",
          legacy: hit.legacy,
        }
      : null;
  }

  return {
    configured: true,
    permitted: true,
    numbers: res.data,
    activeId,
    managerUrl,
    assignments,
    companies,
  };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set by addPhoneNumber so the UI can carry on into verification. */
  id?: string;
  /** What Meta reports for the number right after the change (register/verify). */
  statusAfter?: string | null;
  /** Set by assignNumberToCompany. */
  companyName?: string;
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
  const result: ActionResult = res.ok ? { ok: true, id: res.data.id } : { ok: false, error: res.error };
  await recordNumberEvent("add", `+${cc}${national}`, result, { verifiedName: name });
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
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
  const result: ActionResult = res.ok ? { ok: true } : { ok: false, error: res.error };
  await recordNumberEvent(`request-code-${method.toLowerCase()}`, phoneId, result);
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
}

/**
 * Meta's status for the number just after a change. A step can succeed while
 * the number still is not ready — the page has to say which, instead of a
 * success line the next reload contradicts.
 */
async function statusAfter(phoneId: string): Promise<string | null> {
  const cfg = wabaConfig();
  if (!cfg) return null;
  const fresh = await getNumber(cfg, phoneId);
  return fresh.ok ? fresh.data.connection : null;
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
  const result: ActionResult = res.ok
    ? { ok: true, statusAfter: await statusAfter(phoneId) }
    : { ok: false, error: res.error };
  await recordNumberEvent("verify", phoneId, result);
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
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
  const result: ActionResult = res.ok
    ? { ok: true, statusAfter: await statusAfter(phoneId) }
    : { ok: false, error: res.error };
  await recordNumberEvent("register", phoneId, result);
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
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
  const result: ActionResult = res.ok ? { ok: true } : { ok: false, error: res.error };
  await recordNumberEvent("release", phoneId, result);
  if (res.ok) revalidatePath("/settings/numbers");
  return result;
}

/**
 * Decide which company a number serves: its customers land in that company's
 * inbox and its replies go out from it. See src/lib/whatsapp/number-assignment.ts
 * for what is refused and why.
 */
export async function assignNumberToCompany(
  phoneId: string,
  target: AssignTarget
): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const cfg = wabaConfig();
  if (!cfg) return UNCONFIGURED;

  // The number's identity comes from Meta, not the browser: an id that is not
  // on this account is refused rather than written onto a channel.
  const fresh = await getNumber(cfg, phoneId);
  if (!fresh.ok) {
    const result: ActionResult = { ok: false, error: fresh.error };
    await recordNumberEvent("assign", phoneId, result);
    return result;
  }
  const listed = await listNumbers(cfg);
  if (listed.ok && !listed.data.some((n) => n.id === phoneId)) {
    return { ok: false, error: "That number is not on this WhatsApp Business Account." };
  }

  const out = await assignNumber(getDb(), fresh.data, target);
  const result: ActionResult = out.ok
    ? { ok: true, companyName: out.companyName }
    : { ok: false, error: out.error };
  await recordNumberEvent("assign", fresh.data.displayPhoneNumber, result, {
    company: out.ok ? out.companyName : null,
    createdCompany: out.ok ? out.createdCompany : false,
  });
  if (out.ok) {
    revalidatePath("/settings/numbers");
    revalidatePath("/inbox");
  }
  return result;
}

// Business phone numbers on the WABA — list, add, verify, register.
//
// Why this exists: until now the sending number was a single Worker secret
// (WHATSAPP_PHONE_NUMBER_ID) and nothing in the app could see the WABA's other
// numbers, so "which number are we actually sending from, and is it healthy?"
// could only be answered by logging into WhatsApp Manager. Worse, adding a
// number meant leaving the product entirely.
//
// The lifecycle Meta enforces, in order — each step is one call below:
//
//   1. add        POST /{waba-id}/phone_numbers      → returns a phone number id
//   2. request    POST /{phone-id}/request_code      → SMS or voice to that number
//   3. verify     POST /{phone-id}/verify_code       → the 6 digits they received
//   4. register   POST /{phone-id}/register          → two-step PIN; THIS is what
//                                                      makes it usable by Cloud API
//
// Steps 1–3 put the number on the account. Only step 4 makes it send: a number
// can read VERIFIED in WhatsApp Manager and still be invisible to the Cloud
// API, which is the single most confusing state in this whole platform.
//
// Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers

import { graph, type GraphResult } from "./graph";

// v23.0 to match cloud-api.ts. Mixing versions across modules is how you get a
// field that exists in one call and is silently absent in the next.
const GRAPH = "https://graph.facebook.com/v23.0";

export interface WabaConfig {
  wabaId: string;
  token: string;
}

/** WABA credentials from the environment. Null when not configured — callers
 *  render "not connected yet" rather than throwing. */
export function wabaConfig(): WabaConfig | null {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!wabaId || !token) return null;
  return { wabaId, token };
}

/** The phone number id this app actually sends from, or null in DEMO. */
export function activePhoneNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
}

/**
 * Meta's own words for where a number is in its lifecycle.
 *
 * `connection` (Graph's `status`) is the one that decides delivery: only
 * CONNECTED sends. `codeVerification` is about ownership of the SIM and is
 * where EXPIRED shows up — a requested code that was never entered within
 * Meta's window. EXPIRED is not a dead end; it just means request a new code.
 */
export type CodeVerification = "VERIFIED" | "NOT_VERIFIED" | "EXPIRED" | string;

export interface WabaNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  /** CONNECTED / PENDING / FLAGGED / RESTRICTED / MIGRATED / BANNED / DELETED */
  connection: string | null;
  codeVerification: CodeVerification | null;
  /** APPROVED / AVAILABLE_WITHOUT_REVIEW / DECLINED / PENDING_REVIEW / NONE */
  nameStatus: string | null;
  qualityRating: string | null;
  /** TIER_50 / TIER_250 / TIER_1K … or absent before business verification. */
  limitTier: string | null;
  platformType: string | null;
  /** True when this is the number WHATSAPP_PHONE_NUMBER_ID points at. */
  isActive: boolean;
}

interface RawNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  code_verification_status?: string;
  name_status?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  platform_type?: string;
}

const FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "status",
  "code_verification_status",
  "name_status",
  "quality_rating",
  "messaging_limit_tier",
  "platform_type",
].join(",");

/** Every business phone number on the WABA. */
export async function listNumbers(
  cfg: WabaConfig
): Promise<GraphResult<WabaNumber[]>> {
  const active = activePhoneNumberId();
  const res = await graph<{ data?: RawNumber[] }>(
    `${GRAPH}/${cfg.wabaId}/phone_numbers?fields=${FIELDS}&limit=100`,
    cfg.token
  );
  if (!res.ok) return res;
  const numbers = (res.data.data ?? []).map((n) => ({
    id: n.id,
    displayPhoneNumber: n.display_phone_number ?? "unknown",
    verifiedName: n.verified_name ?? null,
    connection: n.status ?? null,
    codeVerification: n.code_verification_status ?? null,
    nameStatus: n.name_status ?? null,
    qualityRating: n.quality_rating ?? null,
    limitTier: n.messaging_limit_tier ?? null,
    platformType: n.platform_type ?? null,
    isActive: !!active && n.id === active,
  }));
  return { ok: true, data: numbers };
}

/** One number, read fresh from Meta — how an action proves what it changed. */
export async function getNumber(
  cfg: WabaConfig,
  phoneId: string
): Promise<GraphResult<WabaNumber>> {
  const active = activePhoneNumberId();
  const res = await graph<RawNumber>(`${GRAPH}/${phoneId}?fields=${FIELDS}`, cfg.token);
  if (!res.ok) return res;
  const n = res.data;
  return {
    ok: true,
    data: {
      id: n.id,
      displayPhoneNumber: n.display_phone_number ?? "unknown",
      verifiedName: n.verified_name ?? null,
      connection: n.status ?? null,
      codeVerification: n.code_verification_status ?? null,
      nameStatus: n.name_status ?? null,
      qualityRating: n.quality_rating ?? null,
      limitTier: n.messaging_limit_tier ?? null,
      platformType: n.platform_type ?? null,
      isActive: !!active && n.id === active,
    },
  };
}

export interface NewNumber {
  /** Country calling code WITHOUT the plus — "60" for Malaysia. */
  cc: string;
  /** National number without the country code and without a leading zero. */
  phoneNumber: string;
  /** The display name customers see. Meta reviews it. */
  verifiedName: string;
}

/**
 * Put a new number on the WABA.
 *
 * Two refusals are common enough to be worth expecting rather than debugging:
 * the business is capped at two numbers until business verification is done
 * (Meta's own wording: "Your business is only allowed two phone numbers"), and
 * a number already live on the WhatsApp Business *app* must be deleted there
 * first — a number is on the app or the Cloud API, never both.
 */
export async function addNumber(
  cfg: WabaConfig,
  n: NewNumber
): Promise<GraphResult<{ id: string }>> {
  return graph<{ id: string }>(`${GRAPH}/${cfg.wabaId}/phone_numbers`, cfg.token, {
    method: "POST",
    body: JSON.stringify({
      cc: n.cc,
      phone_number: n.phoneNumber,
      verified_name: n.verifiedName,
    }),
  });
}

export type CodeMethod = "SMS" | "VOICE";

/** Ask Meta to send the ownership code to the number itself. */
export async function requestCode(
  cfg: WabaConfig,
  phoneId: string,
  method: CodeMethod,
  language = "en"
): Promise<GraphResult<{ success?: boolean }>> {
  return graph(`${GRAPH}/${phoneId}/request_code`, cfg.token, {
    method: "POST",
    body: JSON.stringify({ code_method: method, language }),
  });
}

/** Submit the code that arrived by SMS or call. */
export async function verifyCode(
  cfg: WabaConfig,
  phoneId: string,
  code: string
): Promise<GraphResult<{ success?: boolean }>> {
  return graph(`${GRAPH}/${phoneId}/verify_code`, cfg.token, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/**
 * Register the number for Cloud API use. This is the step that makes it send.
 *
 * `pin` is the number's six-digit two-step verification PIN. If the number has
 * never had one, this call SETS it — write it down, because changing or
 * deleting the number later asks for it and Meta will not tell you what it was.
 *
 * Rate limit: 10 register/deregister calls per number per rolling 72 hours
 * (error 133016). Not something to retry in a loop.
 */
export async function registerNumber(
  cfg: WabaConfig,
  phoneId: string,
  pin: string
): Promise<GraphResult<{ success?: boolean }>> {
  return graph(`${GRAPH}/${phoneId}/register`, cfg.token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}

/**
 * Release a number from Cloud API. Same 72-hour rate limit as register.
 *
 * This is NOT deletion, and the difference matters to anyone clicking it:
 * deregistering stops the number sending and receiving through this app, but
 * leaves it on the WABA with its message history, and re-registering brings it
 * back. It is the reversible half of "stop using this number".
 */
export async function deregisterNumber(
  cfg: WabaConfig,
  phoneId: string
): Promise<GraphResult<{ success?: boolean }>> {
  return graph(`${GRAPH}/${phoneId}/deregister`, cfg.token, { method: "POST" });
}

/**
 * Where to finish a deletion, because the API cannot do it.
 *
 * Meta is explicit: "You can't delete a business phone number via the API. To
 * delete a business phone number, use WhatsApp Manager instead." It also asks
 * for the account password at that screen, which is the real reason — a number
 * and its entire message history going away should not be reachable by an API
 * token that leaked.
 *
 * So this app deregisters (which it CAN do) and hands the person a link to the
 * exact page for the irreversible half, rather than shipping a Delete button
 * that quietly does something weaker than it says.
 *
 * Two further limits worth knowing before clicking through: a number that has
 * sent paid messages in the last 30 days cannot be deleted at all, and deletion
 * takes the message history with it.
 */
export function whatsAppManagerNumbersUrl(wabaId: string): string {
  return `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(wabaId)}`;
}

/** The WABA id, for links only — never the token. */
export function wabaIdForLinks(): string | null {
  return process.env.WHATSAPP_WABA_ID || null;
}

/**
 * What a person should do next about this number, in one sentence.
 *
 * Meta reports four independent status fields and none of them says "here is
 * your problem". This collapses them into the next action, in the order the
 * platform actually enforces.
 */
export function nextStep(n: WabaNumber): string | null {
  if (n.connection === "BANNED") {
    return "Meta has banned this number. It cannot be recovered here — appeal in WhatsApp Manager.";
  }
  // Ownership questions only apply to a number that is not already serving.
  //
  // `code_verification_status` tracks the SIM-ownership code flow, and it goes
  // EXPIRED whenever a code was requested and never entered — which outlives
  // the registration it was part of. On a CONNECTED number it is a leftover,
  // not a fault: delivery is decided by `status`, `quality_rating` and
  // `messaging_limit_tier`, all of which are healthy by definition here.
  // Reading it first told the owner of a live production number, sending at
  // TIER_250 on GREEN quality, to go re-verify it.
  if (n.connection !== "CONNECTED") {
    if (n.codeVerification === "EXPIRED") {
      return "The verification code expired before it was entered. Send a new one.";
    }
    if (n.codeVerification === "NOT_VERIFIED") {
      return "This number has not proved ownership yet. Send a verification code.";
    }
    if (n.connection === "PENDING") {
      return "Verified, but not registered for Cloud API yet — register it with a six-digit PIN to start sending.";
    }
  }
  if (n.connection === "FLAGGED") {
    return "Meta flagged this number for message quality. It still sends, but the limit tier will drop if it stays flagged.";
  }
  if (n.connection === "RESTRICTED") {
    return "This number hit its messaging limit. It cannot start new conversations until the window resets.";
  }
  if (n.connection === "CONNECTED" && !n.limitTier) {
    return "Sending works, but the messaging limit is still unset — complete business verification to raise it.";
  }
  return null;
}

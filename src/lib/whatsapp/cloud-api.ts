// WhatsApp Cloud API (Meta) — the LIVE transport. Activated when WHATSAPP_MODE=LIVE and
// the env is set (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). In DEMO these functions are
// no-ops so the app runs without a Meta account; flip the env to go live with no other
// code change. Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import type { FlowButton } from "@/lib/automation/types";
import { metaToken } from "./token";

export function isLive(): boolean {
  return (
    process.env.WHATSAPP_MODE === "LIVE" &&
    !!metaToken() &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

// v23.0, not v21.0. WhatsApp usernames are a 2025 feature: on v21 a customer who
// reaches us with only a `user_id` (no phone number anywhere in the webhook)
// cannot be replied to at all — Meta accepts the send, returns a message id, and
// delivers nothing, and `recipient_type: "user_id"` is rejected outright with
// "expected ['group','individual',null]". A newer version is the only place that
// addressing exists.
const GRAPH = "https://graph.facebook.com/v23.0";

/**
 * Somewhere to put Meta's refusal so a human can read it.
 *
 * A rejected send used to go to `console.error` and nowhere else: the row was
 * marked FAILED and the reason — the only part anyone can act on — was gone.
 * Callers that pass this get the message text back and can store it. Optional so
 * the existing call sites keep working unchanged.
 */
export interface SendOutcome {
  error?: string;
}

/**
 * Build the recipient fields for a send.
 *
 * There are two kinds of address and they go in DIFFERENT fields:
 *
 *   phone number → `to`
 *   WhatsApp username → `recipient` (a business-scoped user id, "MY.38162…"),
 *                       and `to` must be omitted entirely
 *
 * Since usernames shipped, a customer can reach us with no phone number at all:
 * the webhook carries only `from_user_id` and the contacts array has `user_id`
 * with no `wa_id`. Putting that id in `to` is the bug that made every reply to
 * such a customer vanish. `to` accepts only phone numbers, so Meta stripped the
 * "MY." and read the rest as one — it answered HTTP 200 with a real message id
 * and `contacts[0].wa_id: "3816205081852835"`, having queued the message for a
 * number that does not exist. Nothing was delivered and no status webhook ever
 * came back, which is why it looked like a silent success for so long.
 *
 * Verified against Graph on 2026-08-15 with the same text to the same contact:
 *   to:        {"input":"MY.3816205081852835","wa_id":"3816205081852835"}   ← wrong
 *   recipient: {"input":"MY.3816205081852835","user_id":"MY.3816205081852835"} ← right
 *
 * `recipient_type` stays "individual" in both cases. It is a closed enum of
 * ["group","individual",null] — passing "user_id" there fails the whole request
 * with code 100, which was the previous wrong turn.
 *
 * Digits mean a phone number; anything else is a username.
 */
export function addressing(to: string): Record<string, unknown> {
  return /^\d+$/.test(to)
    ? { recipient_type: "individual", to }
    : { recipient_type: "individual", recipient: to };
}

/**
 * `from` is the phone number id to send from — the conversation's own number
 * (src/lib/whatsapp/channels.ts). It falls back to WHATSAPP_PHONE_NUMBER_ID only
 * for a caller that has no conversation to ask; a reply must never borrow
 * another company's number because the caller forgot to pass one.
 */
async function post(
  payload: Record<string, unknown>,
  out?: SendOutcome,
  from?: string
): Promise<string | null> {
  const phoneId = from ?? process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = metaToken()!;
  const to = typeof payload.to === "string" ? payload.to : "";
  // `to` is re-added by addressing() only when it is a phone number. Deleting it
  // here is what keeps it out of a username send — Meta says that if both `to`
  // and `recipient` are present, `to` wins, so leaving it in would silently
  // reinstate the original bug.
  const rest = { ...payload };
  delete rest.to;
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      ...addressing(to),
      ...rest,
    }),
  }).catch(() => null);

  if (!res) {
    if (out) out.error = "Could not reach Meta (network error).";
    return null;
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    console.error("WA_SEND_FAIL", res.status, raw);
    if (out) {
      // error_user_msg is the sentence Meta writes for a human; `message` is
      // usually "(#100) Invalid parameter", which explains nothing.
      let text = `Meta returned HTTP ${res.status}.`;
      try {
        const e = (JSON.parse(raw) as { error?: { error_user_msg?: string; message?: string; code?: number } }).error;
        if (e) {
          text = e.error_user_msg ?? e.message ?? text;
          if (e.code) text = `${text} (code ${e.code})`;
        }
      } catch {
        if (raw) text = raw.slice(0, 400);
      }
      out.error = text;
    }
    return null;
  }
  const raw = await res.text().catch(() => "");
  const json = (() => {
    try {
      return JSON.parse(raw) as { messages?: { id: string }[] };
    } catch {
      return null;
    }
  })();
  const id = json?.messages?.[0]?.id ?? null;
  if (!id && out) {
    // 200 with no message id. Meta does this for a recipient it accepts the
    // shape of but will not route to — the username case — and it is invisible
    // unless the body is kept, because there is no `error` object to read.
    out.error = `Meta accepted the request but returned no message id. Response: ${raw.slice(0, 300)}`;
  }
  return id;
}

/**
 * What Meta says about the number we send from.
 *
 * The channel row's `phone` column is seeded demo data (`scripts/seed.ts` wrote
 * a placeholder), so the sender shown in the campaign wizard was never the real
 * number. The truth lives at Meta, keyed by WHATSAPP_PHONE_NUMBER_ID — the same
 * id every send goes through — so asking Graph is the only answer that cannot
 * drift from what actually happens.
 *
 * It also returns the two fields that explain a message Meta accepts but never
 * delivers: `status` (a number still CONNECTED vs PENDING/FLAGGED/RESTRICTED)
 * and `quality_rating`. Surfacing them beats reading a dashboard.
 */
export interface PhoneNumberInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  qualityRating: string | null;
  /** CONNECTED / PENDING / FLAGGED / RESTRICTED — the field that decides whether
   *  an accepted message is actually delivered. */
  connection: string | null;
  /** TIER_50 / TIER_250 / TIER_1K … or UNSET before business verification. */
  limitTier: string | null;
  error: string | null;
}

export async function phoneNumberInfo(): Promise<PhoneNumberInfo | null> {
  if (!isLive()) return null;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = metaToken()!;
  // `status` and `messaging_limit_tier` are the two that explain a message Meta
  // accepts (returns an id for) and then never delivers: an unverified business
  // is capped to a small allow-list, and a number that is not CONNECTED sends
  // into nothing. Asking for the verification code status alone missed both.
  const fields =
    "display_phone_number,verified_name,code_verification_status,quality_rating,status,messaging_limit_tier,platform_type,throughput";
  const res = await fetch(`${GRAPH}/${phoneId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!res) {
    return { displayPhoneNumber: null, verifiedName: null, status: null, qualityRating: null, connection: null, limitTier: null, error: "Could not reach Meta." };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const e = (json?.error ?? {}) as { error_user_msg?: string; message?: string };
    return {
      displayPhoneNumber: null,
      verifiedName: null,
      status: null,
      qualityRating: null,
      connection: null,
      limitTier: null,
      // error_user_msg first: Meta's generic `message` is often "(#100) Invalid parameter".
      error: e.error_user_msg ?? e.message ?? `Meta returned ${res.status}.`,
    };
  }
  return {
    displayPhoneNumber: (json?.display_phone_number as string) ?? null,
    verifiedName: (json?.verified_name as string) ?? null,
    status: (json?.code_verification_status as string) ?? null,
    qualityRating: (json?.quality_rating as string) ?? null,
    connection: (json?.status as string) ?? null,
    limitTier: (json?.messaging_limit_tier as string) ?? null,
    error: null,
  };
}

/** Send a plain text message. Returns the Meta message id (for status reconciliation). */
export async function sendText(
  to: string,
  body: string,
  out?: SendOutcome,
  from?: string
): Promise<string | null> {
  if (!isLive()) return null;
  return post({ to, type: "text", text: { body } }, out, from);
}

/** Send interactive reply buttons (max 3, per Cloud API limits). */
export async function sendButtons(
  to: string,
  body: string,
  buttons: FlowButton[],
  out?: SendOutcome,
  from?: string
): Promise<string | null> {
  if (!isLive()) return null;
  return post({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.label.slice(0, 20) },
        })),
      },
    },
  }, out, from);
}

/** Send an approved template message. */
export async function sendTemplate(
  to: string,
  name: string,
  languageCode = "en",
  components?: unknown[],
  out?: SendOutcome,
  from?: string
): Promise<string | null> {
  if (!isLive()) return null;
  return post(
    {
      to,
      type: "template",
      template: { name, language: { code: languageCode }, ...(components ? { components } : {}) },
    },
    out,
    from
  );
}

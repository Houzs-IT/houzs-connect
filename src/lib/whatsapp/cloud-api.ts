// WhatsApp Cloud API (Meta) — the LIVE transport. Activated when WHATSAPP_MODE=LIVE
// and WHATSAPP_TOKEN is set. In DEMO these are no-ops so the app runs without a Meta
// account. MULTI-TENANT: the phone-number id is passed PER CALL (from the sending
// channel — channel.phoneNumberId), NOT read from env. One Meta Business + one
// System-User token (WHATSAPP_TOKEN) serves every company's number; the send path
// just switches the /{phone_number_id}/messages target per channel.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import type { FlowButton } from "@/lib/automation/types";

export function isLive(): boolean {
  return process.env.WHATSAPP_MODE === "LIVE" && !!process.env.WHATSAPP_TOKEN;
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function post(
  phoneNumberId: string,
  payload: Record<string, unknown>
): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN!;
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    console.error("WA_SEND_FAIL", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json().catch(() => null)) as
    | { messages?: { id: string }[] }
    | null;
  return json?.messages?.[0]?.id ?? null;
}

/** Send a plain text message from a specific channel's number. Returns the Meta
 *  message id (for status reconciliation). */
export async function sendText(
  phoneNumberId: string,
  to: string,
  body: string
): Promise<string | null> {
  if (!isLive() || !phoneNumberId) return null;
  return post(phoneNumberId, { to, type: "text", text: { body } });
}

/** Send interactive reply buttons (max 3, per Cloud API limits). */
export async function sendButtons(
  phoneNumberId: string,
  to: string,
  body: string,
  buttons: FlowButton[]
): Promise<string | null> {
  if (!isLive() || !phoneNumberId) return null;
  return post(phoneNumberId, {
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
  });
}

/** Send an approved template message from a specific channel's number. */
export async function sendTemplate(
  phoneNumberId: string,
  to: string,
  name: string,
  languageCode = "en",
  components?: unknown[]
): Promise<string | null> {
  if (!isLive() || !phoneNumberId) return null;
  return post(phoneNumberId, {
    to,
    type: "template",
    template: { name, language: { code: languageCode }, ...(components ? { components } : {}) },
  });
}

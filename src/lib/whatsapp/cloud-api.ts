// WhatsApp Cloud API (Meta) — the LIVE transport. Activated when WHATSAPP_MODE=LIVE and
// the env is set (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). In DEMO these functions are
// no-ops so the app runs without a Meta account; flip the env to go live with no other
// code change. Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
import type { FlowButton } from "@/lib/automation/types";

export function isLive(): boolean {
  return (
    process.env.WHATSAPP_MODE === "LIVE" &&
    !!process.env.WHATSAPP_TOKEN &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function post(payload: Record<string, unknown>): Promise<string | null> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_TOKEN!;
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
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

/** Send a plain text message. Returns the Meta message id (for status reconciliation). */
export async function sendText(to: string, body: string): Promise<string | null> {
  if (!isLive()) return null;
  return post({ to, type: "text", text: { body } });
}

/** Send interactive reply buttons (max 3, per Cloud API limits). */
export async function sendButtons(
  to: string,
  body: string,
  buttons: FlowButton[]
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
  });
}

/** Send an approved template message. */
export async function sendTemplate(
  to: string,
  name: string,
  languageCode = "en",
  components?: unknown[]
): Promise<string | null> {
  if (!isLive()) return null;
  return post({
    to,
    type: "template",
    template: { name, language: { code: languageCode }, ...(components ? { components } : {}) },
  });
}

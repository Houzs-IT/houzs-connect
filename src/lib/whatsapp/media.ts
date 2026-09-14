// Media + contact-card sends over the Meta WhatsApp Cloud API.
//
// This sits beside cloud-api.ts and reads its config the same way (process.env,
// surfaced on the Worker by OpenNext). It is a SEPARATE module rather than more
// functions in cloud-api.ts for one reason: cloud-api's `post()` swallows Graph's
// error into console.error and returns null, which is fine for a bot send but
// useless for an operator who just picked a file — they need to be told *why*
// Meta refused. Everything here returns the error text instead.
//
// Docs:
//   upload   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
//   messages https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

import { MAX_CAPTION_CHARS, type AttachmentKind } from "./media-limits";
import { addressing } from "./cloud-api";

// v23.0 to match cloud-api.ts. The `recipient` field that addresses a WhatsApp
// username was verified against v23.0; v21.0 predates usernames entirely, so
// leaving this behind would make attachments the one path that still breaks.
const GRAPH = "https://graph.facebook.com/v23.0";

export interface MediaApiConfig {
  phoneId: string;
  token: string;
}

/**
 * Phone-number id + token from the environment, or null when the number is not
 * configured. Callers surface null as "WhatsApp is not connected" rather than
 * throwing — same contract as templateConfig() in templates.ts.
 */
export function mediaConfig(senderId?: string | null): MediaApiConfig | null {
  // A media id belongs to the number it was uploaded under, so the upload and
  // the send must both use the conversation's own number (channels.ts).
  const phoneId = senderId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneId || !token) return null;
  return { phoneId, token };
}

export type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface GraphError {
  error?: { message?: string; error_user_msg?: string; code?: number };
}

/** Pull the most human sentence out of a Graph error body. */
function graphError(text: string, status: number): string {
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — fall through to the raw text.
  }
  const g = json as GraphError | null;
  // error_user_msg is the sentence Meta shows in its own UI; `message` is
  // usually "(#100) Invalid parameter", which helps nobody.
  return (
    g?.error?.error_user_msg || g?.error?.message || text.slice(0, 300) || `HTTP ${status}`
  );
}

/**
 * Upload the bytes to the phone number's media store and get a media id back.
 *
 * POST {phone-number-id}/media, multipart/form-data with
 *   messaging_product=whatsapp
 *   type=<mime>
 *   file=<binary>
 * → { "id": "<media-id>" }
 *
 * The id is good for 30 days on Meta's side and is what the message send below
 * references — we never host the file ourselves.
 */
export async function uploadMedia(
  cfg: MediaApiConfig,
  file: Blob,
  fileName: string,
  mimeType: string
): Promise<GraphResult<{ id: string }>> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  // slice() re-labels the blob's content type without copying the bytes: the
  // browser's reported type may be "" or octet-stream, and the part's
  // Content-Type is what Meta validates against `type`.
  form.append("file", file.slice(0, file.size, mimeType), fileName);

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${cfg.phoneId}/media`, {
      method: "POST",
      // No Content-Type header on purpose — fetch has to set the multipart
      // boundary itself, and setting it by hand breaks the body.
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      ok: false,
      error:
        err?.name === "TimeoutError"
          ? "The upload to Meta timed out. Try a smaller file."
          : (err?.message ?? "Network error while uploading to Meta."),
    };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, error: graphError(text, res.status) };

  let id: string | undefined;
  try {
    id = (JSON.parse(text) as { id?: string }).id;
  } catch {
    id = undefined;
  }
  if (!id) return { ok: false, error: "Meta accepted the upload but returned no media id." };
  return { ok: true, data: { id } };
}

/** POST a message payload and return the Meta message id. */
async function postMessage(
  cfg: MediaApiConfig,
  payload: Record<string, unknown>
): Promise<GraphResult<string>> {
  // Same split as the text path: a phone number goes in `to`, a WhatsApp
  // username goes in `recipient` with `to` removed. Without this an attachment
  // or contact card sent to a username customer is accepted by Meta and
  // delivered to a phantom number — see addressing() in cloud-api.ts.
  const to = typeof payload.to === "string" ? payload.to : "";
  const rest = { ...payload };
  delete rest.to;
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${cfg.phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...addressing(to), ...rest }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      ok: false,
      error:
        err?.name === "TimeoutError"
          ? "Meta did not respond in time."
          : (err?.message ?? "Network error"),
    };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, error: graphError(text, res.status) };
  let id: string | undefined;
  try {
    id = (JSON.parse(text) as { messages?: { id: string }[] }).messages?.[0]?.id;
  } catch {
    id = undefined;
  }
  if (!id) return { ok: false, error: "Meta returned no message id." };
  return { ok: true, data: id };
}

/**
 * Send an already-uploaded image or document.
 *
 *   image    → { type: "image",    image:    { id, caption? } }
 *   document → { type: "document", document: { id, filename, caption? } }
 *
 * `filename` is what the customer sees in their chat and in their downloads —
 * without it WhatsApp shows the media id, which looks like a scam.
 */
export async function sendMediaMessage(
  cfg: MediaApiConfig,
  to: string,
  kind: AttachmentKind,
  mediaId: string,
  opts: { fileName?: string; caption?: string } = {}
): Promise<GraphResult<string>> {
  const caption = opts.caption?.trim().slice(0, MAX_CAPTION_CHARS);
  if (kind === "IMAGE") {
    return postMessage(cfg, {
      to,
      type: "image",
      image: { id: mediaId, ...(caption ? { caption } : {}) },
    });
  }
  return postMessage(cfg, {
    to,
    type: "document",
    document: {
      id: mediaId,
      ...(opts.fileName ? { filename: opts.fileName } : {}),
      ...(caption ? { caption } : {}),
    },
  });
}

/**
 * Send an already-uploaded voice note: { type: "audio", audio: { id } }.
 *
 * Separate from sendMediaMessage because an audio message takes NOTHING else —
 * no caption (Meta ignores one) and no filename (WhatsApp shows a waveform, not
 * a file row). Adding either to the payload would be sending the operator's
 * words nowhere while our own thread claimed they went out.
 *
 * What makes this render as a voice note rather than a file is the bytes: Ogg
 * with the Opus codec, uploaded as `audio/ogg`. See lib/whatsapp/voice.ts —
 * this function is only ever reached with a recording that format allowed.
 */
export async function sendVoiceNoteMessage(
  cfg: MediaApiConfig,
  to: string,
  mediaId: string
): Promise<GraphResult<string>> {
  return postMessage(cfg, { to, type: "audio", audio: { id: mediaId } });
}

/**
 * One entry of a WhatsApp `contacts` message — the vCard WhatsApp renders as a
 * tappable "Add contact" card. Meta requires `name.formatted_name` plus at
 * least one other name field, so buildContactCard() below always sets both.
 */
export interface WaContactCard {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: { phone: string; type?: string; wa_id?: string }[];
  emails?: { email: string; type?: string }[];
  org?: { company?: string };
}

/**
 * Turn one of our contact rows into a card Meta will accept.
 *
 * `phone` is stored as digits (the webhook strips everything else), which is
 * exactly the wa_id format; the display number gets a leading + so the customer
 * sees an international number.
 */
export function buildContactCard(row: {
  name: string | null;
  phone: string;
  email?: string | null;
  company?: string | null;
}): WaContactCard {
  const digits = row.phone.replace(/[^\d]/g, "");
  const display = (row.name ?? "").trim() || (digits ? `+${digits}` : row.phone);
  const parts = display.split(/\s+/);
  return {
    name: {
      formatted_name: display,
      first_name: parts[0] || display,
      ...(parts.length > 1 ? { last_name: parts.slice(1).join(" ") } : {}),
    },
    phones: [
      {
        phone: digits ? `+${digits}` : row.phone,
        type: "CELL",
        ...(digits ? { wa_id: digits } : {}),
      },
    ],
    ...(row.email ? { emails: [{ email: row.email, type: "WORK" }] } : {}),
    ...(row.company ? { org: { company: row.company } } : {}),
  };
}

/** Send one or more contact cards: { type: "contacts", contacts: [ … ] }. */
export async function sendContactsMessage(
  cfg: MediaApiConfig,
  to: string,
  contacts: WaContactCard[]
): Promise<GraphResult<string>> {
  return postMessage(cfg, { to, type: "contacts", contacts });
}

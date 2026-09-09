"use server";

/**
 * Composer actions that talk to Meta directly: attachments and contact cards.
 *
 * Deliberately NOT in src/app/actions.ts — that file is the app-wide action
 * surface and these are the inbox composer's own.
 *
 * Every export here is an async function. A "use server" module may only export
 * async functions, so the size/type constants and result types live in
 * @/lib/whatsapp/media-limits (which the browser imports too) rather than here.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { contact, conversation, message } from "@/db/schema";
import { isLive } from "@/lib/whatsapp/cloud-api";
import {
  checkAttachment,
  MAX_CAPTION_CHARS,
  resolveMimeType,
  safeFileName,
} from "@/lib/whatsapp/media-limits";
import {
  buildContactCard,
  mediaConfig,
  sendVoiceNoteMessage,
  uploadMedia,
} from "@/lib/whatsapp/media";
import { checkVoiceNote, formatDuration, VOICE_UPLOAD_MIME } from "@/lib/whatsapp/voice";
import { sendOutboundContacts, sendOutboundMedia } from "@/lib/whatsapp/transport";

/**
 * A signed-in member, and the conversation must be in THEIR company.
 *
 * The same guard as src/app/actions.ts and inbox/actions.ts, and it is not
 * optional here: everything exported from a "use server" module is a POST
 * endpoint reachable by anyone who can find the action id, and what these
 * actions do is SEND A WHATSAPP MESSAGE. Without the company check any
 * signed-in user could push a file into another tenant's customer thread.
 */
async function authorizeConversation(conversationId: string) {
  if (!conversationId) return null;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo || convo.contact.companyId !== me.companyId) return null;
  return { me, db, convo };
}

const NOT_YOURS =
  "You are not signed in, or this conversation does not belong to your company.";

/**
 * Upload a file to Meta and send it on the conversation.
 *
 * Two hops, both to Graph:
 *   1. POST {phone-number-id}/media  (multipart: messaging_product, type, file)
 *      → media id
 *   2. POST {phone-number-id}/messages with { type: "image" | "document", … }
 *      referencing that id
 *
 * The message row is written by sendOutboundMedia() in the transport, which
 * stamps the returned wa id or flips the row to FAILED — the same pattern the
 * text and template sends already use.
 */
export async function sendAttachment(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const caption = String(formData.get("caption") ?? "")
    .trim()
    .slice(0, MAX_CAPTION_CHARS);
  // Blob, not File: File extends Blob and every runtime this ships to gives us
  // one, but a Blob-only entry would still be perfectly sendable, and reading
  // the name off it by hand avoids depending on a global that may not exist.
  const file = formData.get("file");
  if (!(file instanceof Blob)) return { ok: false, error: "No file was attached." };
  const originalName = typeof (file as File).name === "string" ? (file as File).name : "attachment";

  const auth = await authorizeConversation(conversationId);
  if (!auth) return { ok: false, error: NOT_YOURS };

  // Re-run the browser's check server-side: it is the only one that counts.
  const mimeType = resolveMimeType(originalName, file.type);
  const check = checkAttachment({ name: originalName, type: mimeType, size: file.size });
  if (!check.ok) return { ok: false, error: check.error };

  const cfg = mediaConfig();
  if (!cfg || !isLive()) {
    // Nothing to fall back to: an attachment only exists once Meta has the
    // bytes, so there is no honest row to record in DEMO. Say so rather than
    // writing a message the customer will never receive.
    return {
      ok: false,
      error:
        "WhatsApp is not connected (DEMO mode), so there is nowhere to upload the file. " +
        "Attachments need WHATSAPP_MODE=LIVE with the phone number id and token set.",
    };
  }

  const fileName = safeFileName(originalName);
  const uploaded = await uploadMedia(cfg, file, fileName, check.mimeType);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };

  const sent = await sendOutboundMedia(conversationId, {
    kind: check.kind,
    mediaId: uploaded.data.id,
    mimeType: check.mimeType,
    fileName,
    caption,
    sentByMemberId: auth.me.id,
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return sent;
}

/** The name on the multipart part. WhatsApp shows a waveform, never this. */
const VOICE_FILE_NAME = "voice-note.ogg";

/**
 * Upload a recorded voice note and send it on the conversation.
 *
 * The two Graph hops are exactly the attachment path's and are the same code:
 * uploadMedia() puts the bytes at {phone-number-id}/media, then
 * sendVoiceNoteMessage() sends { type: "audio", audio: { id } } — no caption
 * and no filename, because an audio message carries neither.
 *
 * The message row is written here rather than through sendOutboundMedia() in
 * the transport, and that is a deliberate, narrow exception. OutboundMedia.kind
 * is IMAGE | DOCUMENT, and its mediaBody() turns anything that is not an image
 * into "[document] …" — so routing a voice note through it would file every one
 * of them in the inbox as a document. The thread would then describe a message
 * the customer never received, which is the exact failure mode this codebase
 * keeps paying for. The insert below therefore mirrors sendOutboundMedia()
 * step for step (blocked gate first, row before the send, waMessageId or FAILED
 * stamped after) and any change there belongs here too.
 */
export async function sendVoiceNote(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const clip = formData.get("audio");
  if (!(clip instanceof Blob)) return { ok: false, error: "No recording was attached." };
  const rawDuration = Number(formData.get("durationMs") ?? 0);
  const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : 0;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return { ok: false, error: NOT_YOURS };

  // The same gate every other send passes: a blocked contact must leave no
  // trace of a message that was never meant to exist.
  if (auth.convo.contact.blocked) {
    const who = auth.convo.contact.name ?? auth.convo.contact.phone;
    return { ok: false, error: `${who} is blocked — unblock them on the Contacts page to message them.` };
  }

  // Re-run the browser's check here: that one is a courtesy, this one counts.
  const check = checkVoiceNote({ type: clip.type, size: clip.size });
  if (!check.ok) return { ok: false, error: check.error };

  const cfg = mediaConfig();
  if (!cfg || !isLive()) {
    // Same as an attachment: the recording only exists once Meta holds the
    // bytes, so there is no honest row to write in DEMO.
    return {
      ok: false,
      error:
        "WhatsApp is not connected (DEMO mode), so there is nowhere to upload the recording. " +
        "Voice notes need WHATSAPP_MODE=LIVE with the phone number id and token set.",
    };
  }

  const uploaded = await uploadMedia(cfg, clip, VOICE_FILE_NAME, VOICE_UPLOAD_MIME);
  if (!uploaded.ok) return { ok: false, error: uploaded.error };
  const mediaId = uploaded.data.id;

  const [row] = await auth.db
    .insert(message)
    .values({
      conversationId,
      direction: "OUT",
      type: "AUDIO",
      body: durationMs > 0 ? `[voice note] ${formatDuration(durationMs)}` : "[voice note]",
      // Meta hosts the audio for 30 days; this app has no blob store. Same
      // convention the inbound webhook uses for customer media.
      mediaUrl: `whatsapp-media:${mediaId}`,
      isBot: false,
      sentByMemberId: auth.me.id,
      status: "SENT",
      interactivePayload: {
        kind: "media",
        mediaId,
        mimeType: VOICE_UPLOAD_MIME,
        fileName: VOICE_FILE_NAME,
        ...(durationMs > 0 ? { durationMs } : {}),
      },
    })
    .returning();

  await auth.db
    .update(conversation)
    .set({ lastMessageAt: new Date(), unreadCount: 0 })
    .where(eq(conversation.id, conversationId));

  const sent = await sendVoiceNoteMessage(cfg, auth.convo.contact.phone, mediaId);
  // A row that reads SENT while the customer got nothing is worse than no row.
  await auth.db
    .update(message)
    .set(sent.ok ? { waMessageId: sent.data } : { status: "FAILED" })
    .where(eq(message.id, row.id));

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/** How many contacts the composer's picker shows at once. */
const CONTACT_PAGE = 40;

/**
 * The company's contacts, for the "Send Contact" picker. Scoped to the caller's
 * company — the picker must never be able to enumerate another tenant's people.
 */
export async function listInboxContacts(
  query = ""
): Promise<{ id: string; name: string | null; phone: string; email: string | null }[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const db = getDb();

  // Strip the LIKE wildcards so a typed "%" searches for a literal %, not
  // "everything", and cap the length so the pattern stays cheap.
  const q = query.replace(/[%_\\]/g, "").trim().slice(0, 60);

  const rows = await db.query.contact.findMany({
    where: q
      ? and(
          eq(contact.companyId, me.companyId),
          or(ilike(contact.name, `%${q}%`), ilike(contact.phone, `%${q}%`))
        )
      : eq(contact.companyId, me.companyId),
    orderBy: asc(contact.name),
    limit: CONTACT_PAGE,
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
  }));
}

/**
 * Send one of the company's contacts as a WhatsApp contact card.
 *
 * POST {phone-number-id}/messages with
 *   { type: "contacts", contacts: [{ name: {…}, phones: [{ phone, wa_id }], … }] }
 * which WhatsApp renders as a tappable card the customer can save or message.
 */
export async function sendContactCard(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) return { ok: false, error: "No contact was chosen." };

  const auth = await authorizeConversation(conversationId);
  if (!auth) return { ok: false, error: NOT_YOURS };

  // The conversation being theirs does not make the CONTACT theirs: the id
  // comes from the browser, so it gets its own company check.
  const row = await auth.db.query.contact.findFirst({
    where: eq(contact.id, contactId),
  });
  if (!row || row.companyId !== auth.me.companyId) {
    return { ok: false, error: "That contact is not in your company." };
  }

  const card = buildContactCard({ name: row.name, phone: row.phone, email: row.email });
  const label = card.name.formatted_name;
  const sent = await sendOutboundContacts(conversationId, [card], {
    body: `[contact] ${label} · ${card.phones?.[0]?.phone ?? row.phone}`,
    sentByMemberId: auth.me.id,
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return sent;
}

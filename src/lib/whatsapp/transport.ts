import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { conversation, message } from "@/db/schema";
import type { FlowButton } from "@/lib/automation/types";
import { isLive, sendButtons, sendFlow, sendTemplate, sendText, type SendOutcome } from "./cloud-api";
import type { AttachmentKind } from "./media-limits";
import {
  mediaConfig,
  sendContactsMessage,
  sendMediaMessage,
  type WaContactCard,
} from "./media";
import { senderForChannel, UNASSIGNED_SENDER } from "./channels";
import { headerForSend } from "./templateMedia";

/**
 * WhatsApp transport. DEMO mode records messages in the DB (no Meta). LIVE mode
 * calls the Cloud API here and reconciles status via webhooks.
 */

export async function getOrCreateConversation(
  channelId: string,
  contactId: string
) {
  const db = getDb();
  const existing = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.channelId, channelId),
      eq(conversation.contactId, contactId),
      ne(conversation.status, "CLOSED")
    ),
    orderBy: desc(conversation.createdAt),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(conversation)
    .values({
      channelId,
      contactId,
      status: "OPEN",
      lastMessageAt: new Date(),
      // NOT opened here. The 24-hour customer-service window is Meta's, and only
      // a message FROM the customer starts it (recordInbound sets it). Opening it
      // on creation meant a contact we had merely added — one who has never
      // written to us — showed "23h 50m window", telling the operator they could
      // reply in free text when Meta will refuse every one of those sends.
      windowExpiresAt: null,
    })
    .returning();
  return created;
}

/** An approved WhatsApp template to send instead of free-form text.
 *  `params` fill the template's {{1}}, {{2}}, … body placeholders IN ORDER. */
export interface TemplateSend {
  name: string;
  lang?: string;
  params?: string[];
}

interface OutboundOptions {
  isBot?: boolean;
  sentByMemberId?: string;
  buttons?: FlowButton[];
  type?: "TEXT" | "INTERACTIVE" | "TEMPLATE";
  /**
   * Send as an approved template rather than free-form text. REQUIRED for any
   * business-initiated message — outside the 24-hour customer-service window
   * Meta rejects plain text, which is every delivery reminder, reschedule and
   * balance-collection message this system exists to send. `body` is still
   * recorded on the message row so the inbox shows what the customer received.
   */
  template?: TemplateSend;
  /**
   * Stored on the row's interactivePayload for a plain text send, so a message
   * can say what produced it (auto replies are found this way). Ignored for
   * buttons, which keep their own payload.
   */
  payload?: Record<string, unknown>;
  /**
   * Send an interactive WhatsApp Flow (a Meta form) instead of text / buttons.
   * `flowId` must be a PUBLISHED Meta Flow id; `flowToken` correlates the
   * customer's submission back to the waiting automation run (we pass the run id).
   */
  flow?: {
    flowId: string;
    flowToken: string;
    cta: string;
    screen: string;
    data?: Record<string, unknown>;
  };
}

/** Send an outbound message on a conversation (DEMO: just record it). */
/**
 * Whether we are allowed to message this conversation's contact at all.
 *
 * The Contacts page has a Block toggle, but nothing consulted it — blocking a
 * contact changed a column and nothing else, so a campaign, an automation or a
 * typed reply still reached them. That gap has teeth right now: `scripts/seed.ts`
 * put four demo contacts in this database on well-formed Malaysian mobile
 * numbers, and with WHATSAPP_MODE=LIVE the only thing standing between a test
 * click and a stranger's phone is this check.
 *
 * Returns the reason when the send must not happen, `null` when it may.
 */
async function blockedReason(
  db: DB,
  conversationId: string
): Promise<string | null> {
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo) return "This conversation no longer exists.";
  if (convo.contact.blocked) {
    return `${convo.contact.name ?? convo.contact.phone} is blocked — unblock them on the Contacts page to message them.`;
  }
  return null;
}

export async function sendOutbound(
  conversationId: string,
  body: string,
  opts: OutboundOptions = {}
) {
  const db = getDb();
  // Before the row is written, not after: a blocked contact should leave no
  // trace of a message that was never meant to exist.
  const blocked = await blockedReason(db, conversationId);
  if (blocked) return null;
  const interactive = !!(opts.buttons && opts.buttons.length > 0);
  const flowSend = !!opts.flow;
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      direction: "OUT",
      type: opts.type ?? (opts.template ? "TEMPLATE" : interactive || flowSend ? "INTERACTIVE" : "TEXT"),
      body,
      isBot: opts.isBot ?? true,
      sentByMemberId: opts.sentByMemberId ?? null,
      status: "SENT",
      // A template send keeps its name, language and parameters, so System
      // Logs can send exactly the same message again after a failure.
      interactivePayload: flowSend
        ? { kind: "flow", cta: opts.flow!.cta, flowToken: opts.flow!.flowToken }
        : interactive
          ? { kind: "buttons", buttons: opts.buttons }
          : (opts.payload ?? (opts.template ? { kind: "template", template: opts.template } : null)),
    })
    .returning();
  await db
    .update(conversation)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversation.id, conversationId));

  // LIVE: actually send via the Meta Cloud API and stamp the returned message id.
  if (isLive()) {
    const convo = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
      with: { contact: true },
    });
    // The number this conversation lives on. A reply goes out from the number the
    // customer wrote to — never the default sender of another company.
    const from = convo ? await senderForChannel(db, convo.channelId) : null;
    if (convo && !from) {
      await db
        .update(message)
        .set({ status: "FAILED", interactivePayload: { kind: "send_error", reason: UNASSIGNED_SENDER } })
        .where(eq(message.id, msg.id));
    }
    if (convo && from) {
      // Meta's refusal text lands here instead of only in console.error. Losing
      // it is what made a whole day of undelivered messages undiagnosable: the
      // row said FAILED and nothing said why.
      const outcome: SendOutcome = {};
      // An image / PDF header template carries its file on every send
      // (templateMedia.ts); a file that will not upload fails the send with
      // that reason instead of letting Meta refuse it for a missing header.
      const header = opts.template ? await headerForSend(db, opts.template.name, opts.template.lang ?? "en", from) : null;
      if (header && !header.ok) outcome.error = header.error;
      const components = opts.template
        ? [
            ...(header?.ok ? [header.component] : []),
            ...(opts.template.params?.length
              ? [{ type: "body", parameters: opts.template.params.map((text) => ({ type: "text", text })) }]
              : []),
          ]
        : [];
      const waId = opts.template
        ? header && !header.ok
          ? null
          : await sendTemplate(
              convo.contact.phone,
              opts.template.name,
              opts.template.lang ?? "en",
              components.length ? components : undefined,
              outcome,
              from
            )
        : opts.flow
          ? await sendFlow(convo.contact.phone, body, opts.flow, outcome, from)
          : interactive
            ? await sendButtons(convo.contact.phone, body, opts.buttons ?? [], outcome, from)
            : await sendText(convo.contact.phone, body, outcome, from);
      // No id back means Meta refused it (bad template, closed window, bad
      // number). The row must say so — a message that reads SENT in the inbox
      // while the customer got nothing is worse than no message at all.
      await db
        .update(message)
        .set(
          waId
            ? { waMessageId: waId }
            : {
                status: "FAILED",
                // interactivePayload is jsonb and is null on a plain outbound
                // text, so the reason rides there rather than behind a new
                // column and a migration on the hot send path.
                interactivePayload: {
                  kind: "send_error",
                  reason: outcome.error ?? "Meta refused the message and gave no reason.",
                  ...(opts.template ? { template: opts.template } : {}),
                },
              }
        )
        .where(eq(message.id, msg.id));
    }
  }
  return msg;
}

/** An image or document already uploaded to Meta, ready to be sent. */
export interface OutboundMedia {
  kind: AttachmentKind;
  /** The id Meta returned from {phone-number-id}/media. */
  mediaId: string;
  mimeType: string;
  fileName: string;
  caption?: string;
  sentByMemberId?: string;
}

/** What the thread shows for an attachment: the caption, plus what was sent. */
function mediaBody(m: OutboundMedia): string {
  const label = m.kind === "IMAGE" ? "image" : "document";
  const tag = `[${label}] ${m.fileName}`;
  const caption = m.caption?.trim();
  return caption ? `${caption}\n${tag}` : tag;
}

/**
 * Send an attachment an operator picked in the composer.
 *
 * Same shape as sendOutbound: record the row first so the inbox never loses a
 * send, then (LIVE only) call Graph and stamp the returned id — or mark the row
 * FAILED, because a message that reads SENT while the customer got nothing is
 * worse than no message at all. Unlike sendOutbound this also RETURNS the
 * failure text: a human is standing at the composer waiting to be told why.
 *
 * We store the media id, not the bytes — Meta hosts the file for 30 days and
 * this app has no blob store. That mirrors what the inbound webhook already
 * records for customer images (`whatsapp-media:<id>`).
 */
export async function sendOutboundMedia(
  conversationId: string,
  m: OutboundMedia
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const blocked = await blockedReason(db, conversationId);
  if (blocked) return { ok: false, error: blocked };
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      direction: "OUT",
      type: m.kind,
      body: mediaBody(m),
      mediaUrl: `whatsapp-media:${m.mediaId}`,
      isBot: false,
      sentByMemberId: m.sentByMemberId ?? null,
      status: "SENT",
      interactivePayload: {
        kind: "media",
        mediaId: m.mediaId,
        mimeType: m.mimeType,
        fileName: m.fileName,
      },
    })
    .returning();
  // An operator replying clears the unread badge, same as a typed reply does.
  await db
    .update(conversation)
    .set({ lastMessageAt: new Date(), unreadCount: 0 })
    .where(eq(conversation.id, conversationId));

  if (!isLive()) return { ok: true };
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo) return { ok: true };

  // Same number the attachment was uploaded under (media-actions.ts), which is
  // the number this conversation lives on.
  const from = await senderForChannel(db, convo.channelId);
  if (!from) {
    await db.update(message).set({ status: "FAILED" }).where(eq(message.id, msg.id));
    return { ok: false, error: UNASSIGNED_SENDER };
  }
  const cfg = mediaConfig(from);
  if (!cfg) return { ok: true };

  const res = await sendMediaMessage(cfg, convo.contact.phone, m.kind, m.mediaId, {
    fileName: m.fileName,
    caption: m.caption,
  });
  await db
    .update(message)
    .set(res.ok ? { waMessageId: res.data } : { status: "FAILED" })
    .where(eq(message.id, msg.id));
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Send one or more contact cards (WhatsApp's `contacts` message type).
 *
 * `body` is the plain-text summary stored on the row so the thread reads
 * sensibly; the cards themselves go on interactivePayload. MessageType has no
 * CONTACT member (db/schema.ts is owned elsewhere), so the row is typed TEXT —
 * the payload is what says otherwise.
 */
export async function sendOutboundContacts(
  conversationId: string,
  cards: WaContactCard[],
  opts: { body: string; sentByMemberId?: string }
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const blocked = await blockedReason(db, conversationId);
  if (blocked) return { ok: false, error: blocked };
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      direction: "OUT",
      type: "TEXT",
      body: opts.body,
      isBot: false,
      sentByMemberId: opts.sentByMemberId ?? null,
      status: "SENT",
      interactivePayload: { kind: "contacts", contacts: cards },
    })
    .returning();
  await db
    .update(conversation)
    .set({ lastMessageAt: new Date(), unreadCount: 0 })
    .where(eq(conversation.id, conversationId));

  if (!isLive()) return { ok: true };
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo) return { ok: true };

  const from = await senderForChannel(db, convo.channelId);
  if (!from) {
    await db.update(message).set({ status: "FAILED" }).where(eq(message.id, msg.id));
    return { ok: false, error: UNASSIGNED_SENDER };
  }
  const cfg = mediaConfig(from);
  if (!cfg) return { ok: true };

  const res = await sendContactsMessage(cfg, convo.contact.phone, cards);
  await db
    .update(message)
    .set(res.ok ? { waMessageId: res.data } : { status: "FAILED" })
    .where(eq(message.id, msg.id));
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Record an inbound message (real WA webhook in LIVE; simulator in DEMO). */
export async function recordInbound(
  conversationId: string,
  body: string,
  meta?: {
    type?: "TEXT" | "INTERACTIVE" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
    interactivePayload?: unknown;
    /** Meta's id for the inbound message (`messages[].id`). Stored so a
     *  redelivery of the same message is recognised, never processed twice. */
    waMessageId?: string | null;
  }
) {
  const db = getDb();
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      direction: "IN",
      type: meta?.type ?? "TEXT",
      body,
      status: "READ",
      interactivePayload: (meta?.interactivePayload as object) ?? null,
      waMessageId: meta?.waMessageId ?? null,
    })
    .returning();
  await db
    .update(conversation)
    .set({
      lastMessageAt: new Date(),
      unreadCount: sql`${conversation.unreadCount} + 1`,
      windowExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .where(eq(conversation.id, conversationId));
  return msg;
}

import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversation, message } from "@/db/schema";
import type { FlowButton } from "@/lib/automation/types";
import { isLive, sendButtons, sendText } from "./cloud-api";

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
      windowExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    })
    .returning();
  return created;
}

interface OutboundOptions {
  isBot?: boolean;
  sentByMemberId?: string;
  buttons?: FlowButton[];
  type?: "TEXT" | "INTERACTIVE" | "TEMPLATE";
}

/** Send an outbound message on a conversation (DEMO: just record it). */
export async function sendOutbound(
  conversationId: string,
  body: string,
  opts: OutboundOptions = {}
) {
  const db = getDb();
  const interactive = !!(opts.buttons && opts.buttons.length > 0);
  const [msg] = await db
    .insert(message)
    .values({
      conversationId,
      direction: "OUT",
      type: opts.type ?? (interactive ? "INTERACTIVE" : "TEXT"),
      body,
      isBot: opts.isBot ?? true,
      sentByMemberId: opts.sentByMemberId ?? null,
      status: "SENT",
      interactivePayload: interactive
        ? { kind: "buttons", buttons: opts.buttons }
        : null,
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
    if (convo) {
      const waId = interactive
        ? await sendButtons(convo.contact.phone, body, opts.buttons ?? [])
        : await sendText(convo.contact.phone, body);
      if (waId) {
        await db
          .update(message)
          .set({ waMessageId: waId })
          .where(eq(message.id, msg.id));
      }
    }
  }
  return msg;
}

/** Record an inbound message (real WA webhook in LIVE; simulator in DEMO). */
export async function recordInbound(
  conversationId: string,
  body: string,
  meta?: {
    type?: "TEXT" | "INTERACTIVE" | "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO";
    interactivePayload?: unknown;
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

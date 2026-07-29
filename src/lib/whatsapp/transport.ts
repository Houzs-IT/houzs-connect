import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { FlowButton } from "@/lib/automation/types";

/**
 * WhatsApp transport. DEMO mode records messages in the DB (no Meta). LIVE mode
 * (Phase 5) will call the Cloud API here and reconcile status via webhooks.
 */

export async function getOrCreateConversation(
  channelId: string,
  contactId: string
) {
  const existing = await db.conversation.findFirst({
    where: { channelId, contactId, status: { not: "CLOSED" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return db.conversation.create({
    data: {
      channelId,
      contactId,
      status: "OPEN",
      lastMessageAt: new Date(),
      windowExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
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
  const interactive = opts.buttons && opts.buttons.length > 0;
  const msg = await db.message.create({
    data: {
      conversationId,
      direction: "OUT",
      type: opts.type ?? (interactive ? "INTERACTIVE" : "TEXT"),
      body,
      isBot: opts.isBot ?? true,
      sentByMemberId: opts.sentByMemberId ?? null,
      status: "SENT",
      interactivePayload: interactive
        ? ({ kind: "buttons", buttons: opts.buttons } as Prisma.InputJsonValue)
        : undefined,
    },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
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
  const msg = await db.message.create({
    data: {
      conversationId,
      direction: "IN",
      type: meta?.type ?? "TEXT",
      body,
      status: "READ",
      interactivePayload: (meta?.interactivePayload as object) ?? undefined,
    },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      unreadCount: { increment: 1 },
      windowExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });
  return msg;
}

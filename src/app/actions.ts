"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import {
  contactTag,
  conversation,
  conversationTag,
  message,
  note,
  payment,
} from "@/db/schema";
import { recordInbound } from "@/lib/whatsapp/transport";
import { handleCustomerReply, handleReceipt, handleInboundMessage } from "@/lib/automation/dispatch";

/** Demo-mode send: records an outbound agent message on the conversation. */
export async function sendMessage(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "reply"); // reply | note
  if (!conversationId || !body) return;

  const db = getDb();
  const me = await getCurrentMember();
  if (!me) return;

  if (kind === "note") {
    await db.insert(note).values({ conversationId, memberId: me.id, body });
  } else {
    await db.insert(message).values({
      conversationId,
      direction: "OUT",
      type: "TEXT",
      body,
      sentByMemberId: me.id,
      status: "SENT",
    });
    await db
      .update(conversation)
      .set({ lastMessageAt: new Date(), unreadCount: 0 })
      .where(eq(conversation.id, conversationId));
  }
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Assign a conversation to an agent and/or department. */
export async function assignConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const agentId = String(formData.get("assignedAgentId") ?? "");
  const departmentId = String(formData.get("assignedDepartmentId") ?? "");
  if (!conversationId) return;

  const set: { assignedAgentId?: string | null; assignedDepartmentId?: string | null } = {};
  if (formData.has("assignedAgentId")) set.assignedAgentId = agentId || null;
  if (formData.has("assignedDepartmentId")) set.assignedDepartmentId = departmentId || null;
  if (!Object.keys(set).length) return;

  const db = getDb();
  await db.update(conversation).set(set).where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Change conversation status (OPEN / CLOSED / QUEUE / PENDING). */
export async function setConversationStatus(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const status = String(formData.get("status") ?? "OPEN").toUpperCase();
  if (!conversationId || !["OPEN", "CLOSED", "QUEUE", "PENDING"].includes(status)) return;

  const db = getDb();
  await db
    .update(conversation)
    .set({
      status: status as "OPEN" | "CLOSED" | "QUEUE" | "PENDING",
      ...(status === "CLOSED" ? { unreadCount: 0 } : {}),
    })
    .where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Add or remove a tag on a conversation + its contact. */
export async function toggleConversationTag(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const remove = formData.get("remove") === "1";
  if (!conversationId || !tagId) return;

  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });
  if (!convo) return;

  if (remove) {
    await db
      .delete(conversationTag)
      .where(and(eq(conversationTag.conversationId, conversationId), eq(conversationTag.tagId, tagId)));
    await db
      .delete(contactTag)
      .where(and(eq(contactTag.contactId, convo.contactId), eq(contactTag.tagId, tagId)));
  } else {
    await db
      .insert(conversationTag)
      .values({ conversationId, tagId })
      .onConflictDoNothing();
    await db
      .insert(contactTag)
      .values({ contactId: convo.contactId, tagId })
      .onConflictDoNothing();
  }
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** DEMO: simulate the customer tapping an interactive button, driving the automation. */
export async function demoTap(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const buttonId = String(formData.get("buttonId") ?? "");
  const buttonLabel = String(formData.get("buttonLabel") ?? "");
  if (!conversationId || !buttonId) return;

  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });
  if (!convo) return;
  await recordInbound(conversationId, buttonLabel || buttonId, {
    type: "INTERACTIVE",
    interactivePayload: { tapped: buttonId },
  });
  await handleCustomerReply(convo.contactId, { buttonId });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** DEMO: simulate the customer sending a payment receipt -> OCR -> record payment. */
export async function demoSendReceipt(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return;
  await recordInbound(conversationId, `[receipt] ${text}`, { type: "IMAGE" });
  await handleReceipt(conversationId, text);
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  revalidatePath("/payments");
}

/** Verify or reject a captured payment. */
export async function setPaymentStatus(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!paymentId || !["VERIFIED", "REJECTED", "PENDING"].includes(status)) return;

  const db = getDb();
  await db
    .update(payment)
    .set({ status: status as "VERIFIED" | "REJECTED" | "PENDING" })
    .where(eq(payment.id, paymentId));
  revalidatePath("/payments");
}

/** DEMO: simulate the customer sending a free-text message (drives collect_input). */
export async function demoCustomerText(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return;

  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });
  if (!convo) return;
  await recordInbound(conversationId, text, { type: "TEXT" });
  await handleInboundMessage(convo.contactId, { text });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

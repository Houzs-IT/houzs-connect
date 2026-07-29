"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { MEMBER_COOKIE, getCurrentMember } from "@/lib/current-member";
import { db } from "@/lib/db";
import { recordInbound } from "@/lib/whatsapp/transport";
import { handleCustomerReply, handleReceipt } from "@/lib/automation/dispatch";

/** Dev-only: switch which member you're acting as (for testing org-chart RBAC). */
export async function actAsMember(formData: FormData) {
  const id = String(formData.get("memberId") ?? "");
  const jar = await cookies();
  jar.set(MEMBER_COOKIE, id, { path: "/", httpOnly: false, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** Demo-mode send: records an outbound agent message on the conversation. */
export async function sendMessage(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "reply"); // reply | note
  if (!conversationId || !body) return;

  const me = await getCurrentMember();

  if (kind === "note") {
    await db.note.create({
      data: { conversationId, memberId: me.id, body },
    });
  } else {
    await db.message.create({
      data: {
        conversationId,
        direction: "OUT",
        type: "TEXT",
        body,
        sentByMemberId: me.id,
        status: "SENT",
      },
    });
    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), unreadCount: 0 },
    });
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
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      ...(formData.has("assignedAgentId")
        ? { assignedAgentId: agentId || null }
        : {}),
      ...(formData.has("assignedDepartmentId")
        ? { assignedDepartmentId: departmentId || null }
        : {}),
    },
  });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Change conversation status (OPEN / CLOSED / QUEUE / PENDING). */
export async function setConversationStatus(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const status = String(formData.get("status") ?? "OPEN").toUpperCase();
  if (!conversationId || !["OPEN", "CLOSED", "QUEUE", "PENDING"].includes(status)) return;
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      status: status as "OPEN" | "CLOSED" | "QUEUE" | "PENDING",
      ...(status === "CLOSED" ? { unreadCount: 0 } : {}),
    },
  });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Add or remove a tag on a conversation + its contact. */
export async function toggleConversationTag(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const remove = formData.get("remove") === "1";
  if (!conversationId || !tagId) return;
  const convo = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!convo) return;

  if (remove) {
    await db.conversationTag.deleteMany({ where: { conversationId, tagId } });
    await db.contactTag.deleteMany({ where: { contactId: convo.contactId, tagId } });
  } else {
    await db.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId, tagId } },
      update: {},
      create: { conversationId, tagId },
    });
    await db.contactTag.upsert({
      where: { contactId_tagId: { contactId: convo.contactId, tagId } },
      update: {},
      create: { contactId: convo.contactId, tagId },
    });
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
  const convo = await db.conversation.findUnique({ where: { id: conversationId } });
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
  await db.payment.update({
    where: { id: paymentId },
    data: { status: status as "VERIFIED" | "REJECTED" | "PENDING" },
  });
  revalidatePath("/payments");
}

/** DEMO: simulate the customer sending a free-text message (drives collect_input). */
export async function demoCustomerText(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return;
  const convo = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!convo) return;
  await recordInbound(conversationId, text, { type: "TEXT" });
  await handleCustomerReply(convo.contactId, { text });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

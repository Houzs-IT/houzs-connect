"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { MEMBER_COOKIE, getCurrentMember } from "@/lib/current-member";
import { db } from "@/lib/db";
import { recordInbound } from "@/lib/whatsapp/transport";
import { handleCustomerReply } from "@/lib/automation/dispatch";

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

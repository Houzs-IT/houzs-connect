"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import {
  contact,
  contactTag,
  conversation,
  conversationTag,
  message,
  note,
  payment,
  tag,
} from "@/db/schema";
import { recordInbound } from "@/lib/whatsapp/transport";
import {
  handleCustomerReply,
  handleReceipt,
  handleInboundMessage,
  handleTagAdded,
} from "@/lib/automation/dispatch";
import { isLive } from "@/lib/whatsapp/cloud-api";

/**
 * A signed-in member, and the conversation must be in THEIR company.
 *
 * Server actions are reachable by anyone who can POST — the (app) layout's
 * redirect only guards page rendering, not these. Every mutation below used to
 * take a conversationId and act on it with no check at all, which meant an
 * unauthenticated caller could reassign conversations, close them, retag them,
 * or mark a payment verified. The company check matters too: an id from another
 * tenant is not this member's to touch.
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

/** Demo-mode send: records an outbound agent message on the conversation. */
export async function sendMessage(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const kind = String(formData.get("kind") ?? "reply"); // reply | note
  if (!conversationId || !body) return;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { me, db } = auth;

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

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { db } = auth;
  await db.update(conversation).set(set).where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Change conversation status (OPEN / CLOSED / QUEUE / PENDING). */
export async function setConversationStatus(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const status = String(formData.get("status") ?? "OPEN").toUpperCase();
  if (!conversationId || !["OPEN", "CLOSED", "QUEUE", "PENDING"].includes(status)) return;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { db } = auth;
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

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { db, convo } = auth;

  if (remove) {
    await db
      .delete(conversationTag)
      .where(and(eq(conversationTag.conversationId, conversationId), eq(conversationTag.tagId, tagId)));
    await db
      .delete(contactTag)
      .where(and(eq(contactTag.contactId, convo.contactId), eq(contactTag.tagId, tagId)));
  } else {
    // Only newly-added tags should fire the TAG_ADDED automations, so detect
    // whether the contact already had this tag before inserting.
    const already = await db.query.contactTag.findFirst({
      where: and(eq(contactTag.contactId, convo.contactId), eq(contactTag.tagId, tagId)),
    });
    await db
      .insert(conversationTag)
      .values({ conversationId, tagId })
      .onConflictDoNothing();
    await db
      .insert(contactTag)
      .values({ contactId: convo.contactId, tagId })
      .onConflictDoNothing();

    if (!already) {
      const [tagRow, contactRow] = await Promise.all([
        db.query.tag.findFirst({ where: eq(tag.id, tagId) }),
        db.query.contact.findFirst({ where: eq(contact.id, convo.contactId) }),
      ]);
      if (tagRow && contactRow) {
        await handleTagAdded(contactRow.companyId, contactRow.id, tagRow.name);
      }
    }
  }
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * The DEMO simulators below fabricate INBOUND customer activity, which drives
 * the automation engine — and in LIVE that engine sends real WhatsApp messages
 * and calls the owner's REST endpoints. They are refused outright once the
 * Worker is LIVE, on top of the normal auth check.
 */
function demoOnly(): boolean {
  return !isLive();
}

/** DEMO: simulate the customer tapping an interactive button, driving the automation. */
export async function demoTap(formData: FormData) {
  if (!demoOnly()) return;
  const conversationId = String(formData.get("conversationId") ?? "");
  const buttonId = String(formData.get("buttonId") ?? "");
  const buttonLabel = String(formData.get("buttonLabel") ?? "");
  if (!conversationId || !buttonId) return;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { convo } = auth;
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
  if (!demoOnly()) return;
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return;
  if (!(await authorizeConversation(conversationId))) return;
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

  // Marking money received is exactly the action that must not be reachable
  // without a session — and only for a payment in the member's own company.
  const me = await getCurrentMember();
  if (!me) return;
  const db = getDb();
  const row = await db.query.payment.findFirst({
    where: eq(payment.id, paymentId),
    with: { contact: true },
  });
  if (!row || row.contact.companyId !== me.companyId) return;

  await db
    .update(payment)
    .set({ status: status as "VERIFIED" | "REJECTED" | "PENDING" })
    .where(eq(payment.id, paymentId));
  revalidatePath("/payments");
}

/** DEMO: simulate the customer sending a free-text message (drives collect_input). */
export async function demoCustomerText(formData: FormData) {
  if (!demoOnly()) return;
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!conversationId || !text) return;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const { convo } = auth;
  await recordInbound(conversationId, text, { type: "TEXT" });
  await handleInboundMessage(convo.contactId, { text });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

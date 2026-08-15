"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import {
  contact,
  contactTag,
  conversation,
  conversationTag,
  note,
  payment,
  quickReply,
  tag,
} from "@/db/schema";
import { recordInbound, sendOutbound } from "@/lib/whatsapp/transport";
import { countPlaceholders, listTemplates, templateConfig } from "@/lib/whatsapp/templates";
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
    // Go through sendOutbound, which is the only path that actually reaches
    // Meta. This used to insert the row here and stop: every reply an operator
    // typed was written to our own database, rendered in the thread with a tick,
    // stamped SENT by us — and never sent. Nothing was ever handed to WhatsApp,
    // which is also why no delivery status ever came back for one (Meta had
    // never heard of the message). Automations looked fine throughout because
    // they always called sendOutbound.
    await sendOutbound(conversationId, body, {
      isBot: false,
      sentByMemberId: me.id,
    });
    await db
      .update(conversation)
      .set({ unreadCount: 0 })
      .where(eq(conversation.id, conversationId));
  }
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Send an approved template on a conversation.
 *
 * Outside the 24-hour window this is the ONLY thing WhatsApp will deliver, so
 * it is not an advanced feature — it is how every reminder, reschedule and
 * balance-collection message gets out. `params` fill the template's {{1}},
 * {{2}}, … in order; `preview` is the resolved copy we store on the message row
 * so the inbox shows what the customer actually received.
 */
export async function sendTemplateMessage(formData: FormData): Promise<void> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const templateName = String(formData.get("templateName") ?? "").trim();
  const language = String(formData.get("language") ?? "en").trim() || "en";
  const preview = String(formData.get("preview") ?? "").trim();
  const paramsRaw = String(formData.get("params") ?? "");
  if (!conversationId || !templateName) return;

  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  const params = paramsRaw
    ? paramsRaw.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];

  await sendOutbound(conversationId, preview || `[template: ${templateName}]`, {
    isBot: false,
    sentByMemberId: auth.me.id,
    type: "TEMPLATE",
    template: { name: templateName, lang: language, params },
  });

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** The approved templates an agent may send, for the composer's picker. */
export async function listSendableTemplates(): Promise<
  { name: string; language: string; body: string; placeholders: number }[]
> {
  const me = await getCurrentMember();
  if (!me) return [];
  const cfg = templateConfig();
  if (!cfg) return [];
  const res = await listTemplates(cfg);
  if (!res.ok) return [];
  return res.templates
    .filter((t) => t.status === "APPROVED")
    .map((t) => ({
      name: t.name,
      language: t.language,
      body: t.body,
      placeholders: countPlaceholders(t.body),
    }));
}

/** Quick replies for the "/" shortcut and the + menu. */
export async function listQuickReplies(): Promise<{ shortcut: string; body: string }[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const db = getDb();
  const rows = await db.query.quickReply.findMany({
    where: eq(quickReply.companyId, me.companyId),
    orderBy: asc(quickReply.shortcut),
  });
  return rows.map((r) => ({ shortcut: r.shortcut, body: r.body }));
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

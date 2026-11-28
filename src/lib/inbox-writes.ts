// The Service inbox's write cores, shared by the app's server actions
// (src/app/actions.ts sendMessage / assignConversation / setConversationStatus,
// contacts/actions.ts setContactRemarks) and the AI Connector's confirmed
// actions (src/lib/mcp/write-actions.ts, round 4b). ONE write path: the
// connector does not have its own way to send, assign or note — it runs the
// exact code the inbox buttons run, as the person.
//
// NOT a "use server" module on purpose: a server action is a public POST
// endpoint, and the connector must never import one (scripts/smoke-mcp.mjs).
// These functions do no authentication themselves — every caller decides who
// is acting (the session cookie for the app, the connector token + a
// confirmed proposal for the connector) and calls authorizeConversationFor
// first, which is the inbox's own company rule.

import { and, eq, type InferSelectModel } from "drizzle-orm";
import type { DB } from "@/db/client";
import { contact, conversation, conversationMember, member, note } from "@/db/schema";
import { getVisibility } from "@/lib/access";
import { conversationVisible, inboxWriteRefusal, type InboxWrite } from "@/lib/inbox-guard";
import { can } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { setConversationClosedAt } from "@/db/ensure-conversation-closed-at";
import { sendOutbound } from "@/lib/whatsapp/transport";

export const CONVERSATION_STATUSES = ["OPEN", "CLOSED", "QUEUE", "PENDING"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const REMARKS_MAX = 2000;

/** Extra activity detail, e.g. { via: "AI Connector" }. */
type Via = Record<string, string | null | undefined>;

/**
 * The inbox's own rule for touching a conversation: it must exist and its
 * customer must be in the acting member's company (a conversation of another
 * company of a unified inbox is switched into first, never acted on across
 * companies). Returns the conversation with its contact, or null.
 */
export async function authorizeConversationFor(db: DB, me: { companyId: string }, conversationId: string) {
  if (!conversationId) return null;
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo || convo.contact.companyId !== me.companyId) return null;
  return convo;
}

export type AuthorizedConversation = NonNullable<Awaited<ReturnType<typeof authorizeConversationFor>>>;

type Actor = Pick<InferSelectModel<typeof member>, "id" | "companyId" | "role" | "departmentId">;

/** Is this person a chat member (conversation_member) of the conversation? A missing table = no. */
async function isChatMember(db: DB, conversationId: string, memberId: string): Promise<boolean> {
  try {
    const r = await db.query.conversationMember.findFirst({
      where: and(eq(conversationMember.conversationId, conversationId), eq(conversationMember.memberId, memberId)),
      columns: { id: true },
    });
    return !!r;
  } catch {
    return false;
  }
}

/**
 * The full rule for an inbox WRITE (lib/inbox-guard.ts): the company rule
 * above, then the rail's org-chart visibility for this person, then the Roles
 * page's "Reply to customers" / "Assign chats" switch the write needs.
 * Returns the conversation, or the refusal in words.
 */
export async function authorizeInboxWrite(
  db: DB,
  me: Actor,
  conversationId: string,
  write: InboxWrite
): Promise<{ ok: true; convo: AuthorizedConversation } | { ok: false; error: string }> {
  const convo = await authorizeConversationFor(db, me, conversationId);
  if (!convo) return { ok: false, error: "Conversation not found in this company." };
  const [seeAll, reply, assign] = await Promise.all([can(me, "seeAll"), can(me, "reply"), can(me, "assign")]);
  const allMembers = await db.query.member.findMany({
    where: eq(member.companyId, me.companyId),
    columns: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers, seeAll);
  const visible = conversationVisible(vis, convo) || (await isChatMember(db, convo.id, me.id));
  const refusal = inboxWriteRefusal(write, visible, { reply, assign });
  return refusal ? { ok: false, error: refusal } : { ok: true, convo };
}

/**
 * A typed reply, through sendOutbound — the only path that reaches Meta (it
 * refuses a blocked contact and returns null). Clears the unread count, as the
 * composer's send always has. `replyTo` must already be checked to be a wamid of
 * this same thread.
 */
export async function sendReplyCore(db: DB, conversationId: string, memberId: string, body: string, replyTo?: string) {
  const msg = await sendOutbound(conversationId, body, { isBot: false, sentByMemberId: memberId, replyTo });
  await db.update(conversation).set({ unreadCount: 0 }).where(eq(conversation.id, conversationId));
  return msg;
}

/** An internal note on a conversation (the composer's Note mode). Never reaches the customer. */
export async function addConversationNoteCore(db: DB, conversationId: string, memberId: string, body: string): Promise<void> {
  await db.insert(note).values({ conversationId, memberId, body });
}

/** Assign a conversation to an agent and/or department (a key left out is not touched). */
export async function assignConversationCore(
  db: DB,
  actor: { id: string },
  convo: { id: string; contact: { companyId: string } },
  set: { assignedAgentId?: string | null; assignedDepartmentId?: string | null },
  via?: Via
): Promise<void> {
  if (!Object.keys(set).length) return;
  await db.update(conversation).set(set).where(eq(conversation.id, convo.id));
  if ("assignedAgentId" in set) {
    const toName = set.assignedAgentId
      ? ((await db.query.member.findFirst({ where: eq(member.id, set.assignedAgentId), columns: { name: true } }))?.name ?? null)
      : null;
    await logActivity(db, {
      companyId: convo.contact.companyId,
      actorMemberId: actor.id,
      entityType: "conversation",
      entityId: convo.id,
      action: set.assignedAgentId ? "assigned" : "unassigned",
      detail: { to: toName, ...via },
    });
  }
}

/** Change a conversation's status (OPEN / CLOSED / QUEUE / PENDING); closing clears unread and stamps closed_at. */
export async function setConversationStatusCore(
  db: DB,
  actor: { id: string },
  convo: { id: string; contact: { companyId: string } },
  status: ConversationStatus,
  via?: Via
): Promise<void> {
  await db
    .update(conversation)
    .set({ status, ...(status === "CLOSED" ? { unreadCount: 0 } : {}) })
    .where(eq(conversation.id, convo.id));
  // Stamp closed_at on close (cleared on reopen) so the dashboard can measure
  // resolution time. Raw-SQL column kept out of the Drizzle schema — see
  // ensure-conversation-closed-at.ts.
  await setConversationClosedAt(db, convo.id, status === "CLOSED");
  await logActivity(db, {
    companyId: convo.contact.companyId,
    actorMemberId: actor.id,
    entityType: "conversation",
    entityId: convo.id,
    action: "status",
    detail: { status, ...via },
  });
}

/**
 * Save a contact's Remarks (contact.attributes.remarks) in `companyId`. An
 * empty value clears it. Returns false when the contact is not in that company.
 */
export async function saveContactRemarksCore(db: DB, companyId: string, contactId: string, remarks: string): Promise<boolean> {
  const target = await db.query.contact.findFirst({ where: and(eq(contact.id, contactId), eq(contact.companyId, companyId)) });
  if (!target) return false;
  const next: Record<string, unknown> = { ...(target.attributes as Record<string, unknown> | null) };
  const value = remarks.trim().slice(0, REMARKS_MAX);
  // An emptied box clears the note rather than storing "".
  if (value) next.remarks = value;
  else delete next.remarks;
  await db.update(contact).set({ attributes: next }).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId)));
  return true;
}

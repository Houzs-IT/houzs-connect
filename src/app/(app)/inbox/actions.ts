"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { contact, conversation, conversationMember, member } from "@/db/schema";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { conversationVisibilityWhere, getVisibility } from "@/lib/access";
import type { ConversationListItem } from "@/components/inbox/ConversationList";

/**
 * A signed-in member, and the conversation must be in THEIR company.
 *
 * Same guard as src/app/actions.ts: everything exported from a "use server"
 * module is a POST endpoint, reachable by anyone who can find the action id.
 * Without this, an unauthenticated caller could re-queue or unassign any
 * conversation by id, and an id from another tenant is not this member's to
 * touch either.
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

/** How many conversations the rail loads per page — newest first. */
const PAGE_SIZE = 200;

/**
 * An offset this deep is already tens of thousands of conversations back; the
 * value arrives from the browser, so cap it rather than let a hand-made call
 * ask Postgres to walk an unbounded scan.
 */
const MAX_OFFSET = 20_000;

/**
 * One page of the conversation rail. The inbox layout awaits this for the first
 * page and the rail calls it again for each "Load more" — one query, one shape,
 * so the appended rows cannot drift from the rendered ones.
 *
 * Paging is by offset, not by a keyset cursor on lastMessageAt: that column is
 * nullable, and in a DESC order Postgres puts those NULLs first, which no
 * "older than X" cursor can express. The rail dedupes by id, so the one row
 * that can shift while paging is absorbed rather than shown twice.
 */
export async function fetchConversations(
  offset = 0
): Promise<{ items: ConversationListItem[]; hasMore: boolean }> {
  const me = await getCurrentMember();
  if (!me) return { items: [], hasMore: false };
  const db = getDb();

  const off = Math.min(Math.max(0, Math.floor(Number(offset) || 0)), MAX_OFFSET);

  const allMembers = await db.query.member.findMany({
    columns: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers);

  // One row over the page size is how "is there anything older" gets answered
  // without a second COUNT over the same predicate.
  const rows = await db.query.conversation.findMany({
    where: conversationVisibilityWhere(vis),
    orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
    limit: PAGE_SIZE + 1,
    offset: off,
    with: {
      contact: true,
      assignedAgent: true,
      tagLinks: { with: { tag: true } },
      messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit: 1 },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const items = page.map((c) => {
    const latest = c.messages[0];
    return {
      id: c.id,
      name: c.contact.name ?? c.contact.phone,
      phone: c.contact.phone,
      status: c.status,
      unread: c.unreadCount,
      lastMessage: latest?.body ?? "",
      lastAt: (latest?.createdAt ?? c.lastMessageAt)?.toISOString() ?? null,
      // The customer is waiting on us only while the NEWEST message is theirs;
      // the moment anyone replies, the row stops counting.
      waitingSince:
        latest && latest.direction === "IN" ? latest.createdAt.toISOString() : null,
      agent: c.assignedAgent?.name ?? null,
      tags: c.tagLinks.map((t) => ({ name: t.tag.name, color: t.tag.color })),
    };
  });

  return { items, hasMore };
}

/**
 * Put a conversation back in the unread state.
 *
 * The count is set to 1 rather than restored to what it was: the original
 * number is gone by the time an agent asks for this, and the only thing the
 * action promises is that the row comes back under the Unread tab.
 */
export async function markConversationUnread(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  await auth.db
    .update(conversation)
    .set({ unreadCount: 1 })
    .where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/** Hand a conversation back to the shared queue. */
export async function pushConversationToQueue(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  await auth.db
    .update(conversation)
    .set({ status: "QUEUE" })
    .where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Record whether this customer still wants marketing messages.
 *
 * The contact panel rendered this as a switch that showed the current value and
 * swallowed every click. The flag is not decoration: createAndSendCampaign
 * filters the audience on it, so when a customer told an agent "stop sending me
 * promotions" there was nothing in the UI that could write that down, and the
 * next broadcast went to them anyway. The automation engine's opt_in / opt_out
 * nodes already set the same column — this is the manual path to it.
 */
export async function setContactMarketingOptIn(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const optIn = String(formData.get("optIn") ?? "") === "1";
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  await auth.db
    .update(contact)
    .set({ marketingOptIn: optIn })
    .where(eq(contact.id, auth.convo.contactId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Pull a colleague into this conversation as a watcher.
 *
 * Deliberately NOT assignment: assignedAgentId stays exactly as it was, because
 * "the manager is watching this escalation" and "the manager now owns the reply"
 * are different statements and the panel used to be able to make only the second
 * one. Adding the same person twice is a no-op — two agents on a slow panel both
 * pressing Add is ordinary, not an error — which is what the non-partial unique
 * index (conversation_id, member_id) is the ON CONFLICT target for.
 */
export async function addChatMember(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return;
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  // The member id comes from the browser. Being allowed to touch THIS
  // conversation is not permission to attach an arbitrary id: without this,
  // a member of another tenant could be written into this company's thread
  // (and would then be named in its panel and its header).
  const target = await auth.db.query.member.findFirst({
    where: eq(member.id, memberId),
    columns: { id: true, companyId: true },
  });
  if (!target || target.companyId !== auth.me.companyId) return;

  await ensureConversationMemberTable(auth.db);
  await auth.db
    .insert(conversationMember)
    .values({ conversationId, memberId, addedByMemberId: auth.me.id })
    .onConflictDoNothing({
      target: [conversationMember.conversationId, conversationMember.memberId],
    });
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Take a watcher back off the conversation.
 *
 * No company check on `memberId` beyond the conversation guard: the delete is
 * keyed by (this conversation, that member), so the worst a forged id can do is
 * match no row. The row could only have been created through addChatMember,
 * which does check.
 */
export async function removeChatMember(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return;
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  await ensureConversationMemberTable(auth.db);
  await auth.db
    .delete(conversationMember)
    .where(
      and(
        eq(conversationMember.conversationId, conversationId),
        eq(conversationMember.memberId, memberId)
      )
    );
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

/**
 * Drop the agent assignment, leaving the department alone — "unassign" here
 * means "nobody owns this right now", not "take it out of the department".
 */
export async function unassignConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  await auth.db
    .update(conversation)
    .set({ assignedAgentId: null })
    .where(eq(conversation.id, conversationId));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
}

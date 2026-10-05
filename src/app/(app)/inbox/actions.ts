"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { automationRun, contact, conversation, conversationMember, member } from "@/db/schema";
import { ensureConversationMemberTable } from "@/db/ensure-conversation-member";
import { conversationCompanyWhere, conversationVisibilityWhere, getVisibility } from "@/lib/access";
import type { ConversationListItem } from "@/components/inbox/ConversationList";
import { bypassReadCache } from "@/db/fresh";
import { photoSrcs } from "@/lib/member-photo";
import { attrs, displayName, mediaCaption } from "@/lib/format";
import { can } from "@/lib/permissions";

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
  const vis = getVisibility(me, allMembers, await can(me, "seeAll"));

  // The watcher links are read below; on a deploy that lands before the
  // migration the table may not exist yet (see ensure-conversation-member.ts).
  await ensureConversationMemberTable(db).catch(() => {});

  // One row over the page size is how "is there anything older" gets answered
  // without a second COUNT over the same predicate.
  const rows = await db.query.conversation.findMany({
    // Fresh (db/fresh.ts): the rail is refreshed every few seconds to surface new
    // customer messages; a cached page would sit a minute behind.
    where: and(conversationCompanyWhere(db, me.companyId), conversationVisibilityWhere(vis), bypassReadCache()),
    orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
    limit: PAGE_SIZE + 1,
    offset: off,
    with: {
      contact: true,
      assignedAgent: true,
      assignedDepartment: true,
      tagLinks: { with: { tag: true } },
      memberLinks: { columns: { memberId: true } },
      messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit: 1 },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Customers a flow is currently waiting on — the "Bot handling" filter. One
  // read for the whole page (automation_run is indexed by contact_id, mig 0008).
  const contactIds = [...new Set(page.map((c) => c.contactId))];
  const botRows = contactIds.length
    ? await db
        .selectDistinct({ contactId: automationRun.contactId })
        .from(automationRun)
        .where(and(inArray(automationRun.contactId, contactIds), eq(automationRun.status, "waiting")))
    : [];
  const botActive = new Set(botRows.map((r) => r.contactId));

  // One lookup for every assignee on the page (lib/member-photo.ts).
  const agentPhotos = await photoSrcs(page.map((c) => c.assignedAgentId));

  const items = page.map((c) => {
    const latest = c.messages[0];
    const a = attrs(c.contact.attributes);
    return {
      id: c.id,
      name: displayName(c.contact.name, c.contact.phone),
      phone: c.contact.phone,
      status: c.status,
      unread: c.unreadCount,
      // A picture / file shows as "Photo" or its file name (plus any caption),
      // not as the "[attachment]" placeholder its body carries.
      lastMessage: latest && (latest.type === "IMAGE" || latest.type === "DOCUMENT") ? mediaCaption(latest.body) : (latest?.body ?? ""),
      lastMedia:
        latest && (latest.type === "IMAGE" || latest.type === "DOCUMENT")
          ? {
              kind: latest.type as "IMAGE" | "DOCUMENT",
              fileName: ((latest.interactivePayload as { fileName?: unknown } | null)?.fileName as string | undefined) ?? null,
            }
          : null,
      lastAt: (latest?.createdAt ?? c.lastMessageAt)?.toISOString() ?? null,
      // The customer is waiting on us only while the NEWEST message is theirs;
      // the moment anyone replies, the row stops counting.
      waitingSince:
        latest && latest.direction === "IN" ? latest.createdAt.toISOString() : null,
      agent: c.assignedAgent?.name ?? null,
      agentId: c.assignedAgentId,
      agentPhoto: (c.assignedAgentId && agentPhotos.get(c.assignedAgentId)) || null,
      departmentId: c.assignedDepartmentId,
      department: c.assignedDepartment?.name ?? null,
      tags: c.tagLinks.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      watcherIds: c.memberLinks.map((l) => l.memberId),
      // The ERP order event writes these onto the contact (api/webhooks/erp).
      orderRef: a.ref_1 || null,
      deliveryDate: a.delivery_date_1 || null,
      starred: a.starred === "1",
      lastType: latest?.type ?? null,
      botActive: botActive.has(c.contactId),
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

/**
 * Clear the unread badge when a conversation is opened — standard inbox
 * behaviour. Before this, unread only cleared on a reply, so a thread whose
 * 24-hour window has closed (you cannot reply, only send a template) stayed
 * marked unread forever after you read it. Only writes when there is something
 * to clear, so re-opening an already-read thread is a no-op and never churns
 * the rail.
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;
  const [changed] = await auth.db
    .update(conversation)
    .set({ unreadCount: 0 })
    .where(and(eq(conversation.id, conversationId), gt(conversation.unreadCount, 0)))
    .returning({ id: conversation.id });
  if (changed) revalidatePath("/inbox");
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

/**
 * Pause or resume the customer's automation run from the Service panel.
 *
 * Paused is a status the engine already ignores: resumeRun only advances a
 * `waiting` run, so a customer's reply to a paused flow goes to the agent
 * instead of the bot. The dedupe in dispatch.ts counts `paused` as active, so
 * the same flow does not simply start over on the next message. Resume puts
 * the run back to `waiting` on the step it stopped at.
 *
 * Only a run that is parked on a step (cursor set) can be paused — a `running`
 * run is mid-execution for a few milliseconds and has nothing to stop.
 */
export async function setAutomationRunPaused(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const runId = String(formData.get("runId") ?? "");
  const pause = String(formData.get("pause") ?? "") === "1";
  if (!runId) return;
  const auth = await authorizeConversation(conversationId);
  if (!auth) return;

  // The run must belong to THIS conversation's customer.
  await auth.db
    .update(automationRun)
    .set({ status: pause ? "paused" : "waiting" })
    .where(
      and(
        eq(automationRun.id, runId),
        eq(automationRun.contactId, auth.convo.contactId),
        eq(automationRun.status, pause ? "waiting" : "paused"),
        isNotNull(automationRun.cursorNodeId)
      )
    );
  revalidatePath(`/inbox/${conversationId}`);
}

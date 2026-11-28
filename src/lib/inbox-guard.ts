// Who may act on a Service conversation — the rule every inbox write applies
// on top of the company check (lib/inbox-writes.ts authorizeConversationFor).
//
// Before the 2026-11-28 audit fix the inbox server actions (src/app/actions.ts,
// inbox/actions.ts, inbox/media-actions.ts) checked only that the chat's
// customer was in the person's company. So an agent could reply to, assign or
// close a chat the rail does not show them (any id in the company), and the
// Roles page's "Reply to customers" / "Assign chats" switches were enforced
// nowhere. Now:
//   - visibility: the same org-chart rule as the rail (lib/access.ts
//     conversationVisibilityWhere) — plus a colleague added to the chat as a
//     chat member (conversation_member), whom someone who can see it invited;
//   - "reply" (Reply to customers) for anything that reaches the customer:
//     a typed reply, a template, an attachment, a voice note, a contact card;
//   - "assign" (Assign chats) to change who or which department holds it.
// Internal notes, status, tags and read marks need visibility only.
//
// Pure (no DB) so scripts/smoke-inbox-guard.mjs can pin it.

import type { Visibility } from "@/lib/access";

export type InboxWrite = "reply" | "assign" | "other";
export type InboxCaps = { reply: boolean; assign: boolean };

export const NOT_VISIBLE = "Conversation not found, or not one you can see in Service.";
export const NO_REPLY = 'Your role may not reply to customers (Settings → Roles & permissions: "Reply to customers").';
export const NO_ASSIGN = 'Your role may not assign chats (Settings → Roles & permissions: "Assign chats").';

/** The in-memory twin of conversationVisibilityWhere, for one conversation. */
export function conversationVisible(
  vis: Visibility,
  convo: { assignedAgentId: string | null; assignedDepartmentId: string | null },
  isChatMember = false
): boolean {
  if (vis.scope === "all") return true;
  if (isChatMember) return true;
  if (convo.assignedAgentId && vis.memberIds.includes(convo.assignedAgentId)) return true;
  if (convo.assignedDepartmentId && vis.departmentIds.includes(convo.assignedDepartmentId)) return true;
  return false;
}

/** Why this write is refused, or null when it may go ahead. Visibility first. */
export function inboxWriteRefusal(write: InboxWrite, visible: boolean, caps: InboxCaps): string | null {
  if (!visible) return NOT_VISIBLE;
  if (write === "reply" && !caps.reply) return NO_REPLY;
  if (write === "assign" && !caps.assign) return NO_ASSIGN;
  return null;
}

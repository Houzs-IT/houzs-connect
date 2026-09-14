import { eq, inArray, or, type SQL } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { DB } from "@/db/client";
import { channel, conversation, member } from "@/db/schema";

type Member = InferSelectModel<typeof member>;

/**
 * Org-chart visibility. A member can see a conversation if:
 *  - OWNER / ADMIN → everything in the company
 *  - otherwise: assigned to them, OR assigned to someone who reports up to them
 *    (transitive via managerId), OR assigned to their department, OR unassigned
 *    in their department.
 *  - DRIVER → only conversations they are directly assigned (their delivery jobs).
 */

export type Visibility =
  | { scope: "all" }
  | { scope: "scoped"; memberIds: string[]; departmentIds: string[] };

/** Everyone who reports up to `rootId`, transitively, plus `rootId` itself. */
export function subtreeMemberIds(
  rootId: string,
  members: Pick<Member, "id" | "managerId">[]
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    if (!m.managerId) continue;
    const arr = childrenOf.get(m.managerId) ?? [];
    arr.push(m.id);
    childrenOf.set(m.managerId, arr);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

export function getVisibility(
  me: Pick<Member, "id" | "role" | "departmentId">,
  allMembers: Pick<Member, "id" | "managerId">[]
): Visibility {
  if (me.role === "OWNER" || me.role === "ADMIN") return { scope: "all" };
  if (me.role === "DRIVER")
    return { scope: "scoped", memberIds: [me.id], departmentIds: [] };

  const memberIds = subtreeMemberIds(me.id, allMembers);
  const departmentIds = me.departmentId ? [me.departmentId] : [];
  return { scope: "scoped", memberIds, departmentIds };
}

/** Drizzle `where` predicate for conversations this member may see. `undefined`
 *  means no restriction (OWNER/ADMIN). Feeds db.query.conversation.findMany. */
export function conversationVisibilityWhere(vis: Visibility): SQL | undefined {
  if (vis.scope === "all") return undefined;
  const conds: (SQL | undefined)[] = [
    // memberIds always includes `me`, so never an empty IN.
    inArray(conversation.assignedAgentId, vis.memberIds),
  ];
  if (vis.departmentIds.length) {
    conds.push(inArray(conversation.assignedDepartmentId, vis.departmentIds));
  }
  return or(...conds);
}

/**
 * Conversations that belong to `companyId` — those on one of its channels.
 *
 * Visibility above answers WHO inside a company sees a thread; it does not say
 * WHICH company, and `scope: "all"` put no bound on that at all. With one
 * company on one number the gap was invisible. With a second company's number
 * on the same account, an owner of Houzs Century would have seen Hookka's
 * customers in the rail — rows they then could not open, because every thread
 * action already checks the contact's company. Combine this with the visibility
 * predicate on every conversation list and count.
 */
export function conversationCompanyWhere(db: DB, companyId: string): SQL {
  return inArray(
    conversation.channelId,
    db.select({ id: channel.id }).from(channel).where(eq(channel.companyId, companyId))
  );
}

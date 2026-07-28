import type { Member, Prisma } from "@prisma/client";

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

/** Prisma `where` for conversations this member may see. */
export function conversationVisibilityWhere(
  vis: Visibility
): Prisma.ConversationWhereInput {
  if (vis.scope === "all") return {};
  const or: Prisma.ConversationWhereInput[] = [
    { assignedAgentId: { in: vis.memberIds } },
  ];
  if (vis.departmentIds.length) {
    or.push({ assignedDepartmentId: { in: vis.departmentIds } });
  }
  return { OR: or };
}

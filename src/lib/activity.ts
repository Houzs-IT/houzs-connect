import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { activityLog, member } from "@/db/schema";
import { ensureActivityLogTable } from "@/db/ensure-activity-log";

export type ActivityAction =
  | "assigned"
  | "unassigned"
  | "queued"
  | "status"
  | "tag_added"
  | "tag_removed"
  | "watcher_added"
  | "watcher_removed"
  | "merged"
  | "blocked"
  | "unblocked";

export type ActivityEntry = {
  companyId: string;
  /** The member who did it; null for automation / system. */
  actorMemberId?: string | null;
  entityType: "conversation" | "contact";
  entityId: string;
  action: ActivityAction;
  detail?: Record<string, string | null | undefined>;
};

/**
 * Record one action on the shared inbox. Best-effort by contract: a logging
 * failure (table missing before its migration, a transient DB error) must NEVER
 * break the action it describes, so everything here is wrapped and swallowed.
 */
export async function logActivity(db: DB, entry: ActivityEntry): Promise<void> {
  try {
    await ensureActivityLogTable(db);
    await db.insert(activityLog).values({
      companyId: entry.companyId,
      actorMemberId: entry.actorMemberId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      detail: entry.detail ?? null,
    });
  } catch {
    // Intentionally silent — accountability is worth less than the action.
  }
}

export type ActivityRow = {
  id: string;
  actor: string | null;
  entityType: string;
  entityId: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * Recent activity for a company, newest first — optionally scoped to one entity
 * (a single conversation's / contact's history). Guards for the table not
 * existing yet (returns []) so a deploy before the migration does not 500.
 */
export async function recentActivity(
  db: DB,
  opts: { companyId: string; entityType?: string; entityId?: string; limit?: number }
): Promise<ActivityRow[]> {
  try {
    await ensureActivityLogTable(db);
  } catch {
    return [];
  }
  const where = and(
    eq(activityLog.companyId, opts.companyId),
    opts.entityType ? eq(activityLog.entityType, opts.entityType) : undefined,
    opts.entityId ? eq(activityLog.entityId, opts.entityId) : undefined
  );
  const rows = await db
    .select({
      id: activityLog.id,
      actor: member.name,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      detail: activityLog.detail,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(member, eq(member.id, activityLog.actorMemberId))
    .where(where)
    .orderBy(desc(activityLog.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({
    ...r,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
  }));
}

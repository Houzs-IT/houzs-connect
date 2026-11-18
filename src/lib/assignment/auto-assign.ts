// Auto-assignment: give a genuinely human-bound conversation an owner.
//
// Strategy (B+D, Nico 2026-11-15): least-open-load over ONLINE agents, honoring
// each member's concurrency limit; if nobody eligible is online, fall back to any
// active member under their limit. Fires from the WhatsApp webhook on the first
// inbound that no automation took — NOT on bot/automation-handled threads (see
// api/webhooks/whatsapp/route.ts) — and only while the company has switched it on.
//
// Inert by default: no auto_assign row, or enabled=false, means this does nothing
// and the conversation stays unassigned exactly as before. Never throws — a
// failure here must not cost the customer's message, which is already saved.

import { and, count, eq, isNull, isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { conversation, contact, member } from "@/db/schema";
import { autoAssign } from "@/db/schema";
import { ensureAutoAssignTable } from "@/db/ensure-auto-assign";
import { bypassReadCache } from "@/db/fresh";
import { companyPresence } from "@/lib/presence";
import { logActivity } from "@/lib/activity";

/** The company's auto-assignment config, or null when off / missing / unreadable.
 *  Fresh read (a just-flipped toggle or just-changed scope must count). */
async function getAutoAssign(
  db: DB,
  companyId: string
): Promise<{ enabled: boolean; departmentId: string | null } | null> {
  try {
    await ensureAutoAssignTable(db);
    const row = await db.query.autoAssign.findFirst({
      where: and(eq(autoAssign.companyId, companyId), bypassReadCache()),
      columns: { enabled: true, departmentId: true },
    });
    return row ? { enabled: !!row.enabled, departmentId: row.departmentId ?? null } : null;
  } catch {
    // Table missing and not creatable, or a transient error: treat as off.
    return null;
  }
}

/** Is the company's auto-assignment switch on? Fresh read (a just-flipped toggle must count). */
export async function isAutoAssignEnabled(db: DB, companyId: string): Promise<boolean> {
  return !!(await getAutoAssign(db, companyId))?.enabled;
}

type Candidate = { id: string; concurrencyLimit: number };

/**
 * Choose and assign an owner for a newly human-bound conversation, or do nothing.
 * Returns the assigned member id, or null when disabled, when nobody is eligible,
 * or when the conversation was claimed by someone else first.
 */
export async function autoAssignConversation(
  db: DB,
  args: { companyId: string; conversationId: string }
): Promise<string | null> {
  const { companyId, conversationId } = args;
  try {
    const cfg = await getAutoAssign(db, companyId);
    if (!cfg?.enabled) return null;

    // Eligible = active members of the company. When the company scoped
    // auto-assign to one department (cfg.departmentId), only that department's
    // members are eligible — so a chat never lands on a department that doesn't
    // work the inbox. Unscoped (null) keeps every active member eligible, which
    // matches the manual assignee picker.
    const agents = (await db.query.member.findMany({
      where: and(
        eq(member.companyId, companyId),
        eq(member.active, true),
        cfg.departmentId ? eq(member.departmentId, cfg.departmentId) : undefined
      ),
      columns: { id: true, concurrencyLimit: true },
    })) as Candidate[];
    if (!agents.length) return null;

    // Current OPEN load per agent, company-scoped (contact.companyId), fresh so a
    // conversation assigned seconds ago still counts against its owner.
    const loadRows = await db
      .select({ agentId: conversation.assignedAgentId, open: count() })
      .from(conversation)
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(
        and(
          eq(contact.companyId, companyId),
          eq(conversation.status, "OPEN"),
          isNotNull(conversation.assignedAgentId),
          bypassReadCache()
        )
      )
      .groupBy(conversation.assignedAgentId);
    const openBy = new Map<string, number>(
      loadRows.filter((r) => r.agentId).map((r) => [r.agentId as string, Number(r.open)])
    );

    const presence = await companyPresence(companyId);
    const online = new Set(presence.filter((p) => p.online).map((p) => p.id));

    // concurrencyLimit 0 = no cap (its default; unused until now). >0 is a ceiling.
    const underCap = (a: Candidate) => {
      const load = openBy.get(a.id) ?? 0;
      return a.concurrencyLimit > 0 ? load < a.concurrencyLimit : true;
    };
    // Fewest open conversations wins; tie broken by id so the choice is stable.
    const leastLoaded = (pool: Candidate[]): Candidate | null => {
      let best: Candidate | null = null;
      let bestLoad = Infinity;
      for (const a of pool) {
        const load = openBy.get(a.id) ?? 0;
        if (load < bestLoad || (load === bestLoad && best !== null && a.id < best.id)) {
          best = a;
          bestLoad = load;
        }
      }
      return best;
    };

    const eligible = agents.filter(underCap);
    const chosen =
      leastLoaded(eligible.filter((a) => online.has(a.id))) ?? // online first (D)
      leastLoaded(eligible); // fall back to any active under cap
    if (!chosen) return null;

    // Claim atomically: only if still unassigned, so a racing inbound (or a human
    // who just grabbed it) can't be overwritten. No row updated = we lost the race.
    const claimed = await db
      .update(conversation)
      .set({ assignedAgentId: chosen.id })
      .where(and(eq(conversation.id, conversationId), isNull(conversation.assignedAgentId)))
      .returning({ id: conversation.id });
    if (!claimed.length) return null;

    await logActivity(db, {
      companyId,
      actorMemberId: null, // system
      entityType: "conversation",
      entityId: conversationId,
      action: "assigned",
      detail: { by: "auto", strategy: online.has(chosen.id) ? "least-load-online" : "least-load-fallback" },
    });
    return chosen.id;
  } catch (e) {
    console.error("AUTO_ASSIGN_FAIL", e);
    return null;
  }
}

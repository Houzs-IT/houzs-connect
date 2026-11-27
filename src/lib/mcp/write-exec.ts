// The real I/O behind lib/mcp/write-actions.ts: Connect's own write cores
// (lib/inbox-writes.ts — the code the inbox buttons run) as the person, plus
// the few lookups a proposal needs, all limited to the person's company.
// Imports no "use server" module (scripts/smoke-mcp.mjs walks the imports).

import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { contact, department, member, message } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { bypassReadCache } from "@/db/fresh";
import {
  addConversationNoteCore,
  assignConversationCore,
  authorizeConversationFor,
  saveContactRemarksCore,
  sendReplyCore,
  setConversationStatusCore,
} from "@/lib/inbox-writes";
import type { ExecPort } from "./write-actions";

const VIA = { via: "AI Connector" };

export function connectExec(db: DB, me: { id: string; companyId: string }): ExecPort {
  const convo = (id: string) => authorizeConversationFor(db, me, id);
  return {
    async conversation(id) {
      const c = await convo(id);
      if (!c) return null;
      return {
        id: c.id,
        status: c.status,
        contactId: c.contactId,
        contactBlocked: !!c.contact.blocked,
        windowExpiresAt: c.windowExpiresAt ? c.windowExpiresAt.toISOString() : null,
        assignedAgentId: c.assignedAgentId ?? null,
        assignedDepartmentId: c.assignedDepartmentId ?? null,
      };
    },
    async humanReplySince(conversationId, sinceIso) {
      const since = new Date(sinceIso);
      if (Number.isNaN(since.getTime())) return null;
      const r = await db
        .select({ at: message.createdAt, by: member.name })
        .from(message)
        .leftJoin(member, eq(member.id, message.sentByMemberId))
        .where(and(eq(message.conversationId, conversationId), eq(message.direction, "OUT"), eq(message.isBot, false), gt(message.createdAt, since), bypassReadCache()))
        .orderBy(desc(message.createdAt))
        .limit(1);
      return r[0] ? { by: r[0].by ?? "a colleague", at: r[0].at.toISOString() } : null;
    },
    async members() {
      const r = await db
        .select({ id: member.id, name: member.name, email: member.email })
        .from(member)
        .where(and(eq(member.companyId, me.companyId), eq(member.active, true)))
        .orderBy(asc(member.name));
      return r.map((m) => ({ id: m.id, name: m.name, email: m.email ?? "" }));
    },
    async departments() {
      return db.select({ id: department.id, name: department.name }).from(department).where(eq(department.companyId, me.companyId)).orderBy(asc(department.name));
    },
    async contact(id) {
      const c = await db.query.contact.findFirst({ where: and(eq(contact.id, id), eq(contact.companyId, me.companyId), bypassReadCache()) });
      if (!c) return null;
      const a = (c.attributes ?? {}) as Record<string, unknown>;
      return { id: c.id, name: c.name || c.phone || "the contact", remarks: typeof a.remarks === "string" ? a.remarks : "" };
    },
    async reply(conversationId, text) {
      const msg = await sendReplyCore(db, conversationId, me.id, text);
      if (!msg) return { sent: false, status: "", reason: "the customer is blocked (or the chat no longer exists)" };
      const row = await db.query.message.findFirst({ where: and(eq(message.id, msg.id), bypassReadCache()), columns: { status: true, interactivePayload: true } });
      const p = (row?.interactivePayload ?? {}) as Record<string, unknown>;
      return { sent: true, status: row?.status ?? msg.status, reason: typeof p.reason === "string" ? p.reason : undefined };
    },
    async assign(conversationId, set, status) {
      const c = await convo(conversationId);
      if (!c) throw new Error("conversation not authorized");
      if (Object.keys(set).length) await assignConversationCore(db, me, c, set, VIA);
      if (status) await setConversationStatusCore(db, me, c, status, VIA);
    },
    saveRemarks: (contactId, remarks) => saveContactRemarksCore(db, me.companyId, contactId, remarks),
    addNote: (conversationId, text) => addConversationNoteCore(db, conversationId, me.id, text),
    async audit(e) {
      await logActivity(db, { companyId: me.companyId, actorMemberId: me.id, entityType: e.entityType, entityId: e.entityId, action: e.action, detail: VIA });
    },
  };
}


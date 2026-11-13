// Unified inbox: companies whose conversations share one rail.
//
// Connect is multi-tenant — every page scopes by the session member's company —
// and that stays true for everything that WRITES. The one exception is reading
// the conversation list: one service team answers several brands, and making
// them flip company to see whether 2990's customers are waiting is how a
// customer waits an hour. So the rail, its counts and the whole-book search read
// across a group of companies; opening a thread of another company in the group
// switches the session to that company first (inbox/open/[id]), so every action
// on the thread runs exactly as before, under that company's own rules.
//
// Who sees what is decided per company, from the person's OWN member row there:
// no row (the ERP never granted that company) → nothing from it; a row → that
// company's role matrix and org-chart visibility, same as if they had switched.

import { cache } from "react";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { channel, company, member } from "@/db/schema";
import { conversationCompanyWhere, conversationVisibilityWhere, getVisibility } from "@/lib/access";
import { getCurrentMember, type CurrentMember } from "@/lib/current-member";
import { can } from "@/lib/permissions";

/**
 * Groups of companies (by ERP company code) that share one inbox.
 *
 * Code, not id: the code is the ERP's and the same in every environment, where
 * a cuid differs between staging and production. Owner decision 2026-11-13:
 * Houzs Century and 2990's Home are answered by one service team; Hookka and
 * The Conts keep their own inboxes. A company in no group behaves as before.
 */
export const INBOX_GROUPS: readonly (readonly string[])[] = [["HOUZS", "2990"]];

export interface InboxScope {
  companyId: string;
  companyName: string;
  /** The ERP company code (HOUZS, 2990), or null. */
  code: string | null;
  /** This person's member row in that company. */
  memberId: string;
  role: CurrentMember["role"];
  departmentId: string | null;
}

/**
 * The companies whose conversations this person's rail shows — their own first,
 * then every other company in the same group where they hold an active member
 * row. A company outside any group (or a group with no other grant) is just the
 * person's own company, i.e. exactly the old behaviour.
 */
export async function inboxScopes(db: DB, me: CurrentMember): Promise<InboxScope[]> {
  const own = await db.query.company.findFirst({
    where: eq(company.id, me.companyId),
    columns: { id: true, name: true, code: true },
  });
  const self: InboxScope = {
    companyId: me.companyId,
    companyName: own?.name ?? "",
    code: own?.code ?? null,
    memberId: me.id,
    role: me.role,
    departmentId: me.departmentId,
  };
  const group = own?.code ? INBOX_GROUPS.find((g) => g.includes(own.code!)) : undefined;
  if (!group) return [self];

  const peers = (
    await db.query.company.findMany({
      where: and(inArray(company.code, [...group]), eq(company.active, true), bypassReadCache()),
      columns: { id: true, name: true, code: true },
    })
  ).filter((c) => c.id !== me.companyId);
  if (!peers.length) return [self];

  // The same person in the other companies: the ERP org sync writes one member
  // row per granted company, keyed by email — the same test companyChoices uses.
  const rows = await db.query.member.findMany({
    where: and(
      eq(member.email, me.email),
      eq(member.active, true),
      inArray(member.companyId, peers.map((c) => c.id)),
      bypassReadCache()
    ),
    columns: { id: true, companyId: true, role: true, departmentId: true },
  });
  const rowOf = new Map(rows.map((r) => [r.companyId, r]));
  const others: InboxScope[] = [];
  for (const c of peers) {
    const r = rowOf.get(c.id);
    if (!r) continue;
    others.push({
      companyId: c.id,
      companyName: c.name,
      code: c.code ?? null,
      memberId: r.id,
      role: r.role,
      departmentId: r.departmentId,
    });
  }
  return [self, ...others];
}

/** inboxScopes for the signed-in person, memoised per request — the rail, its
 *  counts and the thread page all ask in one render. */
export const getInboxScopes = cache(async (): Promise<InboxScope[]> => {
  const me = await getCurrentMember();
  if (!me) return [];
  return inboxScopes(getDb(), me);
});

/**
 * Conversations the person may see across their scopes: for each company, its
 * own channels AND the visibility of the person's row there. One OR, so the
 * rail keeps a single ORDER BY / LIMIT over all of them.
 */
export async function unifiedConversationWhere(db: DB, scopes: InboxScope[]): Promise<SQL | undefined> {
  // No scope must mean NO rows. `undefined` would mean "no restriction" to
  // drizzle's and(), which is every tenant's conversations.
  if (!scopes.length) return sql`false`;
  const allMembers = await db.query.member.findMany({ columns: { id: true, managerId: true } });
  const parts = await Promise.all(
    scopes.map(async (s) => {
      const vis = getVisibility(
        { id: s.memberId, role: s.role, departmentId: s.departmentId },
        allMembers,
        await can({ companyId: s.companyId, role: s.role }, "seeAll")
      );
      return and(conversationCompanyWhere(db, s.companyId), conversationVisibilityWhere(vis));
    })
  );
  return parts.length === 1 ? parts[0] : or(...parts);
}

/** The WhatsApp numbers behind the scopes — more than one and the rail labels
 *  each row with the number it came in on (Houzs: 8822 service, 6133 logistics). */
export async function scopeChannels(db: DB, scopes: InboxScope[]) {
  if (!scopes.length) return [];
  return db.query.channel.findMany({
    where: inArray(channel.companyId, scopes.map((s) => s.companyId)),
    columns: { id: true, phone: true, companyId: true, isDefault: true },
  });
}

/** A short label for a company on the rail: its code, else its name. */
export function scopeLabel(s: Pick<InboxScope, "code" | "companyName">): string {
  return s.code ?? s.companyName;
}

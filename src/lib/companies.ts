// Which companies a signed-in person can work in.
//
// A session is one member row, and a member row is one company, so "switching
// company" means signing in as the same person's row in another company. Login
// always lands in the first company; this is how anyone reaches a second one.
//
// Two ways to be allowed in:
//   1. An active member row in that company. The ERP org sync creates these per
//      ERP company grant, so this respects exactly what the ERP decided.
//   2. Owner or admin, for a company that exists ONLY in Connect (no ERP id —
//      Hookka is the first). The ERP sync cannot grant a company the ERP does not
//      have, so without this nobody could ever open that company's inbox.
// An owner is deliberately NOT let into an ERP company the ERP has not granted:
// that grant is the ERP's call, not Connect's.

import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { company, member } from "@/db/schema";

export interface CompanyChoice {
  id: string;
  name: string;
  current: boolean;
  /** No ERP counterpart — an owner/admin gets a member row on first entry. */
  connectOnly: boolean;
}

interface Who {
  companyId: string;
  email: string;
  role: string;
}

export function isOwnerOrAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function companyChoices(db: DB, me: Who): Promise<CompanyChoice[]> {
  const [companies, rows] = await Promise.all([
    db.query.company.findMany({
      columns: { id: true, name: true, erpCompanyId: true },
      // Fresh (db/fresh.ts): a company created a moment ago must be switchable now.
      where: and(eq(company.active, true), bypassReadCache()),
      orderBy: asc(company.createdAt),
    }),
    db.query.member.findMany({
      columns: { companyId: true },
      where: and(eq(member.email, me.email), eq(member.active, true), bypassReadCache()),
    }),
  ]);
  const memberOf = new Set(rows.map((r) => r.companyId));
  return companies
    .filter(
      (c) =>
        c.id === me.companyId ||
        memberOf.has(c.id) ||
        (isOwnerOrAdmin(me.role) && c.erpCompanyId == null)
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      current: c.id === me.companyId,
      connectOnly: c.erpCompanyId == null,
    }));
}

import { cache } from "react";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAccessTables } from "@/db/ensure-access";

/*
  What each role may do. The defaults below are the redesign's starting
  matrix; a company can change any cell on Settings → Roles & permissions, and
  those choices live in connect.role_permission (migration 0013). SUPER_ADMIN
  always has everything — nobody can lock the last key-holder out.
*/

export const CAPABILITIES = [
  "seeAll",
  "reply",
  "assign",
  "campaigns",
  "automations",
  "payments",
  "reports",
  "delivery",
  "settings",
  "approveDept",
  "approveFinal",
  "manageSys",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** The roles shown as columns. OWNER (from the ERP) is treated as ADMIN. */
export const MATRIX_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

const S = "SUPER_ADMIN", A = "ADMIN", M = "MANAGER", G = "AGENT", SL = "SALES", V = "VIEWER", D = "DRIVER";
export const DEFAULTS: Record<Capability, MatrixRole[]> = {
  seeAll: [S, A, M, V],
  reply: [S, A, M, G, SL],
  assign: [S, A, M],
  campaigns: [S, A, M],
  automations: [S, A],
  payments: [S, A, M],
  reports: [S, A, M, SL, V],
  delivery: [S, A, M, D],
  settings: [S, A],
  approveDept: [S, A, M],
  approveFinal: [S],
  manageSys: [S],
};

/** Top roles: everything an admin could do before roles became editable. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "OWNER" || role === "ADMIN";
}

const columnOf = (role: string): MatrixRole => (role === "OWNER" ? "ADMIN" : (role as MatrixRole));

export type Matrix = Record<MatrixRole, Record<Capability, boolean>>;

/** The company's whole matrix: defaults with its saved choices laid over. */
export const companyMatrix = cache(async (companyId: string): Promise<Matrix> => {
  const m = {} as Matrix;
  for (const r of MATRIX_ROLES) {
    m[r] = {} as Record<Capability, boolean>;
    for (const c of CAPABILITIES) m[r][c] = DEFAULTS[c].includes(r);
  }
  try {
    const db = getDb();
    await ensureAccessTables(db);
    const rows = (await db.execute(sql`
      select role, capability, allowed from connect.role_permission where company_id = ${companyId}
    `)) as unknown as { role: string; capability: string; allowed: boolean }[];
    for (const r of rows) {
      if (r.role in m && (CAPABILITIES as readonly string[]).includes(r.capability) && r.role !== "SUPER_ADMIN") {
        m[r.role as MatrixRole][r.capability as Capability] = r.allowed;
      }
    }
  } catch {
    // Table not there and not creatable: the defaults stand.
  }
  return m;
});

/** May this member do that, in their company? */
export async function can(me: { companyId: string; role: string } | null, cap: Capability): Promise<boolean> {
  if (!me) return false;
  if (me.role === "SUPER_ADMIN") return true;
  const m = await companyMatrix(me.companyId);
  return m[columnOf(me.role)]?.[cap] ?? false;
}

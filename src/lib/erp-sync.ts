import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { department, member } from "@/db/schema";
import { roleFromErp } from "@/lib/erp-auth";

/**
 * Mirror the ERP org chart into Connect. Reads every ACTIVE ERP user + their
 * department + manager from `public.*` (shared DB) and upserts them into
 * connect.department / connect.member (keyed by name / email), then resolves
 * the reporting line (ERP numeric manager_id -> the manager's email -> the
 * Connect member id). Idempotent — safe to run on every login.
 *
 * Needs SELECT on public.users, public.roles, public.departments for the
 * houzs_connect role. Best-effort: throws are caught by the caller so a login
 * still succeeds (the single logging-in member is upserted separately).
 */

type ErpUserRow = {
  id: number;
  email: string;
  name: string | null;
  manager_id: number | null;
  role_name: string | null;
  dept_name: string | null;
};

export async function syncOrgChart(companyId: string): Promise<void> {
  const db = getDb();

  const rows = (await db.execute(sql`
    SELECT u.id, u.email, u.name, u.manager_id,
           r.name AS role_name, d.name AS dept_name
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    LEFT JOIN public.departments d ON d.id = u.department_id
    WHERE u.status = 'active'
  `)) as unknown as ErpUserRow[];
  if (!rows.length) return;

  // 1. Departments (by name) — connect.department has no (company,name) unique,
  //    so check-then-insert. Build name -> connect id.
  const deptIdByName = new Map<string, string>();
  const deptNames = [...new Set(rows.map((r) => r.dept_name).filter((x): x is string => !!x))];
  for (const name of deptNames) {
    const existing = await db.query.department.findFirst({
      where: and(eq(department.companyId, companyId), eq(department.name, name)),
    });
    if (existing) {
      deptIdByName.set(name, existing.id);
    } else {
      const [d] = await db.insert(department).values({ companyId, name }).returning();
      deptIdByName.set(name, d.id);
    }
  }

  // 2. Members (by email). Pass 1 sets role/name/department; collect the maps
  //    needed to wire the reporting line in pass 2.
  const emailByErpId = new Map<number, string>();
  const memberIdByEmail = new Map<string, string>();
  for (const r of rows) {
    const email = r.email.toLowerCase();
    emailByErpId.set(r.id, email);
    const departmentId = r.dept_name ? deptIdByName.get(r.dept_name) ?? null : null;
    const [m] = await db
      .insert(member)
      .values({
        companyId,
        email,
        name: r.name ?? email,
        role: roleFromErp(r.role_name),
        title: r.role_name ?? null,
        departmentId,
      })
      .onConflictDoUpdate({
        target: member.email,
        set: {
          name: r.name ?? email,
          role: roleFromErp(r.role_name),
          title: r.role_name ?? null,
          departmentId,
        },
      })
      .returning();
    memberIdByEmail.set(email, m.id);
  }

  // 3. Reporting line — resolve ERP manager_id -> manager email -> Connect id.
  for (const r of rows) {
    if (!r.manager_id) continue;
    const managerEmail = emailByErpId.get(r.manager_id);
    const managerId = managerEmail ? memberIdByEmail.get(managerEmail) : undefined;
    const selfId = memberIdByEmail.get(r.email.toLowerCase());
    if (managerId && selfId && managerId !== selfId) {
      await db.update(member).set({ managerId }).where(eq(member.id, selfId));
    }
  }
}

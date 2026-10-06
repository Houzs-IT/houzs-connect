// ERP -> Houzs Connect org sync (one-way mirror, over the ERP HTTP API).
//
// WHY the API and not SQL: Connect shares the ERP's Supabase, but Connect's DB
// role is permission-denied (SQL 42501) on the ERP's public.companies /
// public.user_companies tables. So the org is mirrored by calling the ERP's own
// authenticated endpoints with a shared service token (Bearer), which the ERP
// treats as a fail-open service user that can see every company.
//
// SCOPE: Connect needs exactly two things from the ERP org — the COMPANIES (so
// multi-tenant scoping resolves and 2990 appears) and the USERS as agent
// identities (for conversation assignment + message attribution). No org chart,
// no departments/positions/role hierarchy is replicated.
//
// Model: one connect.member per (granted company x ERP user), keyed by
// (company_id, erp_user_id). A user with no explicit company grants is fail-open
// and belongs to ALL synced companies. Existing seeded members (no erp_user_id)
// are reconciled by lowercased email so the first sync backfills them instead of
// duplicating. Members are NEVER hard-deleted (they may own conversation
// assignments) — a user removed from the ERP is soft-deactivated (active=false).

import { eq, sql } from "drizzle-orm";
import { company, department, member } from "@/db/schema";
import { roleFromErp } from "@/lib/erp-auth";
import { enforceTeamAccess } from "@/lib/team-access";
import { ensureAccessTables } from "@/db/ensure-access";
import type { DB } from "@/db/client";

// ─────────────────────────── ERP response shapes ───────────────────────────
// Verified against the ERP route handlers (backend/src/routes/*.ts). Only the
// fields this sync consumes are typed; unknown fields are ignored.

/** GET /api/companies -> { companies: [...], activeCompanyId, activeCompanyCode }.
 *  The handler filters to is_active=1 and returns { id, code, name }. */
export interface ErpCompany {
  id: number;
  code: string;
  name: string;
}

/** GET /api/users -> { users: [...] }. Rich row; we consume identity fields plus
 *  the org-chart fields the handler already returns (department + manager). */
export interface ErpUser {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  status: string | null; // 'active' | 'invited' | 'disabled'
  role_name: string | null;
  /** Org hierarchy, consumed by applyOrgHierarchy. Optional so older callers and
   *  fixtures without them still type-check. */
  department_name?: string | null;
  manager_id?: number | null;
}

/** GET /api/users/:id/companies -> { companies: number[] } (granted company ids;
 *  an EMPTY array means fail-open = all companies). */
export type ErpGrantMap = Record<number, number[]>;

export interface ErpOrg {
  companies: ErpCompany[];
  users: ErpUser[];
  grants: ErpGrantMap;
}

// ─────────────────────────── Existing Connect snapshot ───────────────────────────

export interface ExistingCompany {
  id: string;
  erpCompanyId: number | null;
  code: string | null;
  slug: string;
  name: string;
}

export interface ExistingMember {
  id: string;
  companyId: string;
  email: string;
  erpUserId: number | null;
  active: boolean;
}

export interface ExistingOrg {
  companies: ExistingCompany[];
  members: ExistingMember[];
}

// ─────────────────────────── Plan (pure diff) ───────────────────────────

type Role = ReturnType<typeof roleFromErp>;

export interface PlannedCompanyInsert {
  erpCompanyId: number;
  code: string;
  name: string;
  slug: string;
}
export interface PlannedCompanyUpdate {
  id: string; // existing connect company id
  erpCompanyId: number;
  code: string;
  name: string;
}
export interface PlannedMemberInsert {
  erpCompanyId: number; // resolved to connect company_id at apply time
  erpUserId: number;
  email: string;
  name: string;
  phone: string | null;
  title: string | null;
  role: Role;
  status: string;
}
export interface PlannedMemberUpdate {
  id: string; // existing connect member id
  erpUserId: number;
  email: string;
  name: string;
  phone: string | null;
  title: string | null;
  role: Role;
  status: string;
  /** true when we matched a pre-existing seeded member by email and are
   *  backfilling its erp_user_id (the reconcile-not-duplicate path). */
  backfilledErpUserId: boolean;
}
export interface PlannedMemberDeactivate {
  id: string;
  email: string;
  erpUserId: number | null;
}

export interface OrgSyncPlan {
  companies: { insert: PlannedCompanyInsert[]; update: PlannedCompanyUpdate[] };
  members: {
    insert: PlannedMemberInsert[];
    update: PlannedMemberUpdate[];
    deactivate: PlannedMemberDeactivate[];
  };
}

// ─────────────────────────── Helpers ───────────────────────────

/** Slug from an ERP company code: lowercased, non-alphanumerics -> '-'. */
function slugify(code: string): string {
  return (code || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** ERP status -> connect.member.status. Present-but-disabled users keep a
 *  'disabled' status but stay active=true (active=false is reserved for users
 *  REMOVED from the ERP, so the app can tell the two apart). */
function memberStatus(erpStatus: string | null): string {
  return erpStatus === "disabled" ? "disabled" : "active";
}

// ─────────────────────────── Pure planner ───────────────────────────

/**
 * PURE. Given the ERP org snapshot and the current Connect rows, compute the
 * exact set of writes needed to make Connect mirror the ERP. No IO, no mutation
 * — deterministic and unit-testable. applyOrgSync executes the result.
 */
export function planOrgSync(erp: ErpOrg, existing: ExistingOrg): OrgSyncPlan {
  const plan: OrgSyncPlan = {
    companies: { insert: [], update: [] },
    members: { insert: [], update: [], deactivate: [] },
  };

  // ── Companies ──────────────────────────────────────────────
  // Reconcile each ERP company to an existing Connect row by erp_company_id,
  // then by code (case-insensitive), then by slug — so a seeded company gets
  // backfilled rather than duplicated. Build erpCompanyId -> connect id (null
  // for a brand-new company, which has no id until apply inserts it).
  const byErpId = new Map<number, ExistingCompany>();
  const byCode = new Map<string, ExistingCompany>();
  const bySlug = new Map<string, ExistingCompany>();
  for (const c of existing.companies) {
    if (c.erpCompanyId != null) byErpId.set(c.erpCompanyId, c);
    if (c.code) byCode.set(c.code.toLowerCase(), c);
    bySlug.set(c.slug.toLowerCase(), c);
  }

  const connectIdByErpCompany = new Map<number, string | null>();
  const usedSlugs = new Set(existing.companies.map((c) => c.slug.toLowerCase()));

  for (const ec of erp.companies) {
    const match =
      byErpId.get(ec.id) ??
      byCode.get(ec.code.toLowerCase()) ??
      bySlug.get(slugify(ec.code));
    if (match) {
      connectIdByErpCompany.set(ec.id, match.id);
      // Update only when something actually drifted (keeps the diff honest).
      if (
        match.erpCompanyId !== ec.id ||
        (match.code ?? null) !== ec.code ||
        match.name !== ec.name
      ) {
        plan.companies.update.push({
          id: match.id,
          erpCompanyId: ec.id,
          code: ec.code,
          name: ec.name,
        });
      }
    } else {
      connectIdByErpCompany.set(ec.id, null);
      // Unique slug (defends against two ERP codes slugifying the same).
      let slug = slugify(ec.code) || `company-${ec.id}`;
      let n = 2;
      while (usedSlugs.has(slug)) slug = `${slugify(ec.code) || "company"}-${n++}`;
      usedSlugs.add(slug);
      plan.companies.insert.push({ erpCompanyId: ec.id, code: ec.code, name: ec.name, slug });
    }
  }

  const syncedErpCompanyIds = new Set(erp.companies.map((c) => c.id));

  // ── Members ────────────────────────────────────────────────
  // Index existing members for O(1) reconciliation, both ways:
  //   • byCompanyEmail: ALL rows, keyed (connectCompanyId, lowercased email) —
  //     matches login-created / seeded rows (no erp_user_id) AND already-synced
  //     rows. This is the login upsert's unique key, so it must be the PRIMARY
  //     reconcile key: never insert a second row for an email already present in
  //     the company (that would violate member_company_email_unique).
  //   • byCompanyErpUser: rows that already carry erp_user_id, keyed
  //     (connectCompanyId, erpUserId) — the stable identity fallback when a
  //     user's email changed in the ERP.
  const byCompanyEmail = new Map<string, ExistingMember>();
  const byCompanyErpUser = new Map<string, ExistingMember>();
  for (const m of existing.members) {
    byCompanyEmail.set(`${m.companyId}:${m.email.toLowerCase()}`, m);
    if (m.erpUserId != null) byCompanyErpUser.set(`${m.companyId}:${m.erpUserId}`, m);
  }

  // Existing members that WERE synced (have erp_user_id) — anything not touched
  // by this run and no longer justified is soft-deactivated.
  const consumed = new Set<string>();

  for (const u of erp.users) {
    const grant = erp.grants[u.id];
    // Fail-open: no explicit grants (undefined or empty) -> all synced companies.
    const targetErpCompanyIds =
      grant && grant.length > 0
        ? grant.filter((id) => syncedErpCompanyIds.has(id))
        : erp.companies.map((c) => c.id);

    const email = u.email.toLowerCase();
    const role = roleFromErp(u.role_name);
    const name = (u.name ?? "").trim() || email;
    const title = (u.role_name ?? "").trim() || null;
    const status = memberStatus(u.status);

    for (const erpCompanyId of targetErpCompanyIds) {
      const connectCompanyId = connectIdByErpCompany.get(erpCompanyId) ?? null;

      // New company (no connect id yet) -> nothing to match against; insert.
      if (connectCompanyId == null) {
        plan.members.insert.push({
          erpCompanyId,
          erpUserId: u.id,
          email,
          name,
          phone: u.phone ?? null,
          title,
          role,
          status,
        });
        continue;
      }

      // Reconcile by (company, email) FIRST — this is the row a login upsert
      // created (email, no erp_user_id) and the row the unique index protects —
      // then fall back to (company, erp_user_id) for an email that changed in the
      // ERP. Either match is UPDATED (backfilling erp_user_id when it was null),
      // never duplicated.
      const emailHit = byCompanyEmail.get(`${connectCompanyId}:${email}`);
      const userHit = byCompanyErpUser.get(`${connectCompanyId}:${u.id}`);
      const match =
        emailHit && !consumed.has(emailHit.id)
          ? emailHit
          : userHit && !consumed.has(userHit.id)
            ? userHit
            : null;

      if (match) {
        consumed.add(match.id);
        plan.members.update.push({
          id: match.id,
          erpUserId: u.id,
          email,
          name,
          phone: u.phone ?? null,
          title,
          role,
          status,
          backfilledErpUserId: match.erpUserId == null,
        });
        continue;
      }

      // Nothing to reconcile -> insert.
      plan.members.insert.push({
        erpCompanyId,
        erpUserId: u.id,
        email,
        name,
        phone: u.phone ?? null,
        title,
        role,
        status,
      });
    }
  }

  // Soft-deactivate: rows previously synced (have erp_user_id) that this run did
  // NOT reaffirm — the ERP user or grant is gone. Never touches never-synced
  // seeded rows, and never hard-deletes.
  for (const m of existing.members) {
    if (m.erpUserId != null && !consumed.has(m.id) && m.active) {
      plan.members.deactivate.push({ id: m.id, email: m.email, erpUserId: m.erpUserId });
    }
  }

  return plan;
}

// ─────────────────────────── Fetch (ERP HTTP API) ───────────────────────────

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ERP GET ${url} -> ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

/**
 * Pull the two things Connect mirrors — companies + users — plus each user's
 * company grants, from the ERP HTTP API. Fails loudly on any non-200.
 * `base` has no trailing slash (e.g. https://erp.houzscentury.com).
 */
export async function fetchErpOrg(base: string, token: string): Promise<ErpOrg> {
  const root = base.replace(/\/+$/, "");
  const companiesRes = await getJson<{ companies: ErpCompany[] }>(`${root}/api/companies`, token);
  const usersRes = await getJson<{ users: ErpUser[] }>(`${root}/api/users`, token);
  const companies = companiesRes.companies ?? [];
  const users = usersRes.users ?? [];

  const grants: ErpGrantMap = {};
  for (const u of users) {
    const g = await getJson<{ companies: number[] }>(`${root}/api/users/${u.id}/companies`, token);
    grants[u.id] = Array.isArray(g.companies) ? g.companies : [];
  }

  return { companies, users, grants };
}

// ─────────────────────────── Apply (idempotent writes) ───────────────────────────

/**
 * Idempotently ensure the sync columns / indexes exist. Mirrors PR #1's
 * ensureAutomationVersionTable so a fresh deploy works even if migration 0002
 * hasn't been run. Safe to call on every sync.
 */
export async function ensureErpOrgColumns(db: DB): Promise<void> {
  await db.execute(sql`ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "erp_company_id" integer`);
  await db.execute(sql`ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "code" text`);
  await db.execute(sql`ALTER TABLE "connect"."company" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL`);
  // NON-partial unique indexes: bare ON CONFLICT targets (login + sync upserts)
  // won't match a partial index (Postgres 42P10). NULLs are distinct in a unique
  // index, so null-erp_company_id / null-email / null-erp_user_id rows coexist.
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "company_erp_company_id_key" ON "connect"."company" ("erp_company_id")`
  );
  await db.execute(sql`ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "erp_user_id" integer`);
  await db.execute(sql`ALTER TABLE "connect"."member" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL`);
  await db.execute(sql`ALTER TABLE "connect"."member" DROP CONSTRAINT IF EXISTS "member_email_unique"`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "member_company_email_unique" ON "connect"."member" ("company_id", "email")`
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "member_company_erp_user_key" ON "connect"."member" ("company_id", "erp_user_id")`
  );
}

export interface AppliedCounts {
  companiesInserted: number;
  companiesUpdated: number;
  membersInserted: number;
  membersUpdated: number;
  membersDeactivated: number;
}

/**
 * Read the current Connect org snapshot (companies + members) that planOrgSync
 * diffs against. Call ensureErpOrgColumns first so the new columns exist.
 */
export async function loadExistingOrg(db: DB): Promise<ExistingOrg> {
  const companies = await db
    .select({
      id: company.id,
      erpCompanyId: company.erpCompanyId,
      code: company.code,
      slug: company.slug,
      name: company.name,
    })
    .from(company);
  const members = await db
    .select({
      id: member.id,
      companyId: member.companyId,
      email: member.email,
      erpUserId: member.erpUserId,
      active: member.active,
    })
    .from(member);
  return { companies, members };
}

/**
 * Execute the plan. Idempotent (the plan is recomputed from a fresh snapshot on
 * every run, so a second run yields updates, not duplicate inserts) and
 * non-destructive (removed users are soft-deactivated, never deleted).
 */
export async function applyOrgSync(db: DB, plan: OrgSyncPlan): Promise<AppliedCounts> {
  await ensureErpOrgColumns(db);

  // Companies first (members reference the resolved connect company id).
  for (const c of plan.companies.insert) {
    await db
      .insert(company)
      .values({ name: c.name, slug: c.slug, code: c.code, erpCompanyId: c.erpCompanyId, active: true })
      .onConflictDoNothing({ target: company.slug });
  }
  for (const c of plan.companies.update) {
    await db
      .update(company)
      .set({ name: c.name, code: c.code, erpCompanyId: c.erpCompanyId, active: true })
      .where(eq(company.id, c.id));
  }

  // erp_company_id -> connect company id, now that inserts have landed.
  const companyRows = await db
    .select({ id: company.id, erpCompanyId: company.erpCompanyId })
    .from(company);
  const idByErp = new Map<number, string>();
  for (const r of companyRows) if (r.erpCompanyId != null) idByErp.set(r.erpCompanyId, r.id);

  let membersInserted = 0;
  for (const m of plan.members.insert) {
    const companyId = idByErp.get(m.erpCompanyId);
    if (!companyId) continue; // company insert failed/absent — skip rather than orphan
    await db
      .insert(member)
      .values({
        companyId,
        name: m.name,
        email: m.email,
        phone: m.phone,
        title: m.title,
        role: m.role,
        status: m.status,
        erpUserId: m.erpUserId,
        active: true,
      })
      // Bare target — matches the NON-partial member_company_erp_user_key index.
      // (A `where` predicate here would only match a partial index, and there is
      // none, so it would throw 42P10.)
      .onConflictDoNothing({ target: [member.companyId, member.erpUserId] });
    membersInserted++;
  }

  for (const m of plan.members.update) {
    await db
      .update(member)
      .set({
        name: m.name,
        email: m.email,
        phone: m.phone,
        title: m.title,
        // SUPER_ADMIN is granted in Connect, not the ERP — a sync must not take it away.
        role: sql`case when ${member.role}::text = 'SUPER_ADMIN' then ${member.role} else ${m.role}::"connect"."Role" end`,
        status: m.status,
        erpUserId: m.erpUserId,
        active: true,
      })
      .where(eq(member.id, m.id));
  }

  for (const m of plan.members.deactivate) {
    await db.update(member).set({ active: false }).where(eq(member.id, m.id));
  }

  // Connect's own decisions outlive the mirror: people removed from Connect
  // stay inactive, and roles set on the Team page win (lib/team-access.ts).
  await ensureAccessTables(db);
  await enforceTeamAccess(db);

  return {
    companiesInserted: plan.companies.insert.length,
    companiesUpdated: plan.companies.update.length,
    membersInserted,
    membersUpdated: plan.members.update.length,
    membersDeactivated: plan.members.deactivate.length,
  };
}

/**
 * Populate the org chart the base sync leaves blank: each synced member's
 * department and who they report to. Kept OUT of the pure planner (and its
 * apply) so that diff stays a companies + identities mirror — this is a second,
 * idempotent pass over the rows applyOrgSync just wrote, run right after it.
 *
 *  - department: upsert one connect.department per (company, ERP department name)
 *    and point member.department_id at it. The name is the ERP's; each company
 *    keeps its own set, fanned out the same way members are.
 *  - manager: member.manager_id is another member IN THE SAME COMPANY — the row
 *    for the ERP manager, resolved only after every member exists (a manager may
 *    sync after their report). A self-referential ERP loop is dropped.
 *
 * erp_user_id is the join key throughout, so only ERP-synced members are ever
 * touched; manual grants (erp_user_id null, e.g. Hookka) keep what they have.
 */
export async function applyOrgHierarchy(db: DB, erp: ErpOrg): Promise<void> {
  // (company, name) uniqueness makes the department upsert idempotent — bare
  // ON CONFLICT needs a non-partial unique index (Postgres 42P10 otherwise).
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "department_company_name_key" ON "connect"."department" ("company_id", "name")`
  );

  // NUL cannot appear in a company id, ERP name or number, so it is a safe key
  // separator for the composite maps below.
  const SEP = " ";

  const companyRows = await db
    .select({ id: company.id, erpCompanyId: company.erpCompanyId })
    .from(company);
  const connectCompanyByErp = new Map<number, string>();
  for (const r of companyRows) if (r.erpCompanyId != null) connectCompanyByErp.set(r.erpCompanyId, r.id);

  // ERP user -> its department name / manager (an ERP user id).
  const deptOf = new Map<number, string | null>();
  const mgrOf = new Map<number, number | null>();
  for (const u of erp.users) {
    deptOf.set(u.id, (u.department_name ?? "").trim() || null);
    mgrOf.set(u.id, u.manager_id ?? null);
  }

  // The (connect company, department name) pairs we will need — one per company a
  // user is granted, matching the base sync's fan-out.
  const wanted = new Set<string>();
  for (const u of erp.users) {
    const name = deptOf.get(u.id);
    if (!name) continue;
    const grant = erp.grants[u.id];
    const targetErp = grant && grant.length > 0 ? grant : erp.companies.map((c) => c.id);
    for (const ec of targetErp) {
      const cid = connectCompanyByErp.get(ec);
      if (cid) wanted.add(`${cid}${SEP}${name}`);
    }
  }
  for (const key of wanted) {
    const idx = key.indexOf(SEP);
    const companyId = key.slice(0, idx);
    const name = key.slice(idx + 1);
    await db
      .insert(department)
      .values({ companyId, name })
      .onConflictDoNothing({ target: [department.companyId, department.name] });
  }

  const deptRows = await db
    .select({ id: department.id, companyId: department.companyId, name: department.name })
    .from(department);
  const deptIdBy = new Map<string, string>();
  for (const d of deptRows) deptIdBy.set(`${d.companyId}${SEP}${d.name.toLowerCase()}`, d.id);

  const memRows = await db
    .select({ id: member.id, companyId: member.companyId, erpUserId: member.erpUserId })
    .from(member);
  const memberByCompanyUser = new Map<string, string>();
  for (const m of memRows) {
    if (m.erpUserId != null) memberByCompanyUser.set(`${m.companyId}${SEP}${m.erpUserId}`, m.id);
  }

  for (const m of memRows) {
    if (m.erpUserId == null) continue; // manual grants keep their own values
    const name = deptOf.get(m.erpUserId) ?? null;
    const departmentId = name ? deptIdBy.get(`${m.companyId}${SEP}${name.toLowerCase()}`) ?? null : null;
    const erpMgr = mgrOf.get(m.erpUserId) ?? null;
    const resolved = erpMgr ? memberByCompanyUser.get(`${m.companyId}${SEP}${erpMgr}`) ?? null : null;
    const managerId = resolved === m.id ? null : resolved; // never your own manager
    await db.update(member).set({ departmentId, managerId }).where(eq(member.id, m.id));
  }
}

/** Small summary for the dry-run response (counts without the full row dump). */
export function summarizePlan(plan: OrgSyncPlan) {
  return {
    companies: { insert: plan.companies.insert.length, update: plan.companies.update.length },
    members: {
      insert: plan.members.insert.length,
      update: plan.members.update.length,
      deactivate: plan.members.deactivate.length,
    },
  };
}

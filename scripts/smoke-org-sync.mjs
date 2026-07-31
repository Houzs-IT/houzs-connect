// Pure unit smoke for the ERP -> Connect org sync planner (no DB, no network).
//
// Feeds a fixture ERP payload (2 companies, 3 users incl. a pre-existing seeded
// member matched by email, and a previously-synced user now removed) into the
// PURE planOrgSync and asserts the diff:
//   - a new company (2990) is inserted, the seeded one (HOUZS) is updated/backfilled
//   - the seeded member is reconciled by email (updated, NOT duplicated)
//   - member-per-company fan-out (a no-grant user lands in every company)
//   - a removed ERP user is soft-deactivated (never deleted)
//   - ERP role -> member.role enum mapping
//
// Runs under tsx (same hooks as smoke-trigger.mjs) so it can import the real .ts.
// Exits non-zero on any failed assertion. The pure planner asserts need no
// DATABASE_URL. When DATABASE_URL IS set (CI has a Postgres service container),
// an extra DB-backed section replays the real ON CONFLICT upserts twice — the
// ONLY thing that reproduces the 42P10 "no unique constraint matching the ON
// CONFLICT specification" that a PARTIAL unique index causes for a bare target.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/**
 * DB-backed regression for the partial-index bug (only runs with DATABASE_URL).
 * Reproduces the exact upsert shapes that broke prod login + sync:
 *   1. login's onConflictDoUpdate({ target: [company_id, email] })
 *   2. applyOrgSync's company/member inserts (bare ON CONFLICT targets)
 * Runs each twice; a partial index would throw 42P10 on the second pass.
 */
async function dbRegression() {
  const { loadDevVars, scriptDb } = await import("./_env.ts");
  loadDevVars();
  if (!process.env.DATABASE_URL) {
    console.log("  (db regression skipped — no DATABASE_URL)");
    return;
  }

  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { eq, inArray } = await import("drizzle-orm");
  const { company, member } = await import("../src/db/schema.ts");
  const { planOrgSync, applyOrgSync, loadExistingOrg, ensureErpOrgColumns } = await import(
    "../src/lib/sync/erp-org.ts"
  );

  const { db, sql } = scriptDb();
  await migrate(db, {
    migrationsFolder: "src/db/migrations",
    migrationsSchema: "connect",
    migrationsTable: "__drizzle_migrations",
  });
  await ensureErpOrgColumns(db);

  const SLUGS = ["smokenp", "smokenp2"];
  const EMAILS = ["np-login@smoke.test", "np-new@smoke.test", "np-direct@smoke.test"];

  const teardown = async () => {
    await db.delete(member).where(inArray(member.email, EMAILS));
    await db.delete(company).where(inArray(company.slug, SLUGS));
  };
  await teardown();

  // Seed: a company whose slug matches slugify('SMOKENP') and a LOGIN-style
  // member in it (email, no erp_user_id) — exactly the rows the sync reconciles.
  const [seedCo] = await db
    .insert(company)
    .values({ name: "Seed NP", slug: "smokenp" })
    .returning();
  await db.insert(member).values({
    companyId: seedCo.id,
    name: "NP Login",
    email: "np-login@smoke.test",
    role: "AGENT",
  });

  // (1) Login's upsert shape, replayed — the exact prod-crash path.
  for (let i = 0; i < 2; i++) {
    await db
      .insert(member)
      .values({ companyId: seedCo.id, name: `Direct ${i}`, email: "np-direct@smoke.test", role: "AGENT" })
      .onConflictDoUpdate({
        target: [member.companyId, member.email],
        set: { name: `Direct ${i}` },
      });
  }
  const directRows = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.email, "np-direct@smoke.test"));
  assert(directRows.length === 1, `login-shape upsert must keep 1 row, got ${directRows.length}`);

  // (2) Full sync apply, replayed with the SAME plan so the second pass re-runs
  //     the company + member inserts against their bare ON CONFLICT targets.
  const erp = {
    companies: [
      { id: 990001, code: "SMOKENP", name: "Smoke NP" },
      { id: 990002, code: "SMOKENP2", name: "Smoke NP2" }, // brand-new -> company insert
    ],
    users: [
      { id: 990010, email: "np-login@smoke.test", name: "NP Login", phone: null, status: "active", role_name: "Manager" },
      { id: 990011, email: "np-new@smoke.test", name: "NP New", phone: null, status: "active", role_name: "Sales" },
    ],
    grants: { 990010: [], 990011: [990001] }, // login user fail-open (both), new user -> 990001 only
  };
  const plan = planOrgSync(erp, await loadExistingOrg(db));
  await applyOrgSync(db, plan); // pass 1
  await applyOrgSync(db, plan); // pass 2 — throws 42P10 here if any index is partial

  const newCo = await db.select({ id: company.id }).from(company).where(eq(company.slug, "smokenp2"));
  assert(newCo.length === 1, `new company inserted exactly once, got ${newCo.length}`);
  const npNew = await db.select({ id: member.id }).from(member).where(eq(member.email, "np-new@smoke.test"));
  assert(npNew.length === 1, `np-new member inserted exactly once, got ${npNew.length}`);
  const npLogin = await db.select({ id: member.id }).from(member).where(eq(member.email, "np-login@smoke.test"));
  assert(npLogin.length === 2, `np-login must fan out to exactly 2 companies, got ${npLogin.length}`);

  await teardown();
  await sql.end();
  console.log("  db regression PASS: login upsert + sync inserts idempotent (no 42P10)");
}

async function main() {
  const { planOrgSync } = await import("../src/lib/sync/erp-org.ts");

  // ── Existing Connect snapshot ──
  // One seeded company (HOUZS, no erp link yet) and three seeded members in it:
  //   m_alice  — plain seeded (no erp_user_id): must reconcile by email
  //   m_dave   — LOGIN-created row (has email + company, no erp_user_id): the
  //              production path the (company_id, email) unique index protects —
  //              the sync must reconcile+backfill it, NEVER insert a 2nd row
  //   m_carol  — previously synced (erp_user_id 3): user is gone from ERP now
  const existing = {
    companies: [
      { id: "c_houzs", erpCompanyId: null, code: null, slug: "houzs", name: "Houzs" },
    ],
    members: [
      { id: "m_alice", companyId: "c_houzs", email: "alice@houzs.com", erpUserId: null, active: true },
      { id: "m_dave", companyId: "c_houzs", email: "dave@houzs.com", erpUserId: null, active: true },
      { id: "m_carol", companyId: "c_houzs", email: "carol@houzs.com", erpUserId: 3, active: true },
    ],
  };

  // ── ERP snapshot ──
  const erp = {
    companies: [
      { id: 1, code: "HOUZS", name: "Houzs Century" },
      { id: 2, code: "2990", name: "2990 Home" },
    ],
    users: [
      // Owner, no explicit grants -> fail-open to ALL companies. Email differs
      // in case from the seeded row to prove case-insensitive reconciliation.
      { id: 1, email: "Alice@Houzs.com", name: "Alice", phone: "011", status: "active", role_name: "Owner" },
      // Sales exec granted ONLY company 2 -> lands in 2990 alone.
      { id: 2, email: "bob@houzs.com", name: "Bob", phone: null, status: "active", role_name: "Sales Executive" },
      // Dave granted ONLY company 1 (HOUZS), where a login-created row already
      // exists for him -> must be reconciled by (company, email), not duplicated.
      { id: 4, email: "dave@houzs.com", name: "Dave", phone: null, status: "active", role_name: "Manager" },
    ],
    grants: { 1: [], 2: [2], 4: [1] },
  };

  const plan = planOrgSync(erp, existing);

  // ── Companies ──
  assert(plan.companies.insert.length === 1, `expected 1 company insert, got ${plan.companies.insert.length}`);
  assert(plan.companies.insert[0].erpCompanyId === 2, "new company should be ERP id 2 (2990)");
  assert(plan.companies.insert[0].slug === "2990", `expected slug '2990', got '${plan.companies.insert[0].slug}'`);

  assert(plan.companies.update.length === 1, `expected 1 company update, got ${plan.companies.update.length}`);
  assert(plan.companies.update[0].id === "c_houzs", "seeded HOUZS company should be reconciled/updated");
  assert(plan.companies.update[0].erpCompanyId === 1, "HOUZS should be backfilled with ERP id 1");
  assert(plan.companies.update[0].code === "HOUZS", "HOUZS code should be backfilled");

  // ── Member reconciliation (match, not duplicate) ──
  const aliceMatch = plan.members.update.find((m) => m.id === "m_alice");
  assert(aliceMatch, "seeded alice must be matched by email (present in updates)");
  assert(aliceMatch.erpUserId === 1, "alice should be backfilled with erp_user_id 1");
  assert(aliceMatch.backfilledErpUserId === true, "alice match should be flagged as an email backfill");
  assert(aliceMatch.role === "OWNER", `alice role should map to OWNER, got ${aliceMatch.role}`);

  // Alice must NOT be re-inserted into HOUZS (that would be a duplicate).
  const aliceInsertHouzs = plan.members.insert.find((m) => m.erpUserId === 1 && m.erpCompanyId === 1);
  assert(!aliceInsertHouzs, "alice must not be duplicated into HOUZS via insert");

  // ── (company, email) reconcile of a LOGIN-created row (the prod-crash path) ──
  // Dave has a login-created member in HOUZS (email, no erp_user_id). The sync
  // must reconcile it by (company, email) and backfill erp_user_id — and must
  // NOT insert a second HOUZS row (which would violate member_company_email_unique
  // and, before the fix, mirror the exact bug that broke login).
  const daveMatch = plan.members.update.find((m) => m.id === "m_dave");
  assert(daveMatch, "login-created dave must be reconciled by (company, email), present in updates");
  assert(daveMatch.erpUserId === 4, "dave should be backfilled with erp_user_id 4");
  assert(daveMatch.backfilledErpUserId === true, "dave match should be flagged as a (company,email) backfill");
  assert(daveMatch.role === "MANAGER", `dave role should map to MANAGER, got ${daveMatch.role}`);
  const daveInsert = plan.members.insert.find((m) => m.erpUserId === 4);
  assert(!daveInsert, "dave must NOT be inserted as a duplicate (company, email) row");

  // ── Member-per-company fan-out ──
  // Alice (no grants) -> also inserted into 2990. Bob (grant [2]) -> only 2990.
  assert(plan.members.insert.length === 2, `expected 2 member inserts, got ${plan.members.insert.length}`);
  const aliceAt2990 = plan.members.insert.find((m) => m.erpUserId === 1 && m.erpCompanyId === 2);
  assert(aliceAt2990, "alice (no grants) must fan out to 2990");
  const bobAt2990 = plan.members.insert.find((m) => m.erpUserId === 2 && m.erpCompanyId === 2);
  assert(bobAt2990, "bob (granted company 2) must land in 2990");
  assert(bobAt2990.role === "SALES", `bob role should map to SALES, got ${bobAt2990.role}`);
  // Bob is granted ONLY company 2 -> must NOT appear in HOUZS (company 1).
  const bobAt1 = plan.members.insert.find((m) => m.erpUserId === 2 && m.erpCompanyId === 1);
  assert(!bobAt1, "bob must not appear in HOUZS (not granted)");

  // ── Soft-deactivate ──
  assert(plan.members.deactivate.length === 1, `expected 1 deactivate, got ${plan.members.deactivate.length}`);
  assert(plan.members.deactivate[0].id === "m_carol", "removed user carol must be soft-deactivated");

  // ── Idempotency: replaying against the POST-sync snapshot yields zero writes. ──
  const afterCompanies = [
    { id: "c_houzs", erpCompanyId: 1, code: "HOUZS", slug: "houzs", name: "Houzs Century" },
    { id: "c_2990", erpCompanyId: 2, code: "2990", slug: "2990", name: "2990 Home" },
  ];
  const afterMembers = [
    { id: "m_alice", companyId: "c_houzs", email: "alice@houzs.com", erpUserId: 1, active: true },
    { id: "m_alice2990", companyId: "c_2990", email: "alice@houzs.com", erpUserId: 1, active: true },
    { id: "m_bob2990", companyId: "c_2990", email: "bob@houzs.com", erpUserId: 2, active: true },
    { id: "m_dave", companyId: "c_houzs", email: "dave@houzs.com", erpUserId: 4, active: true },
    // carol already deactivated -> excluded from further deactivation.
    { id: "m_carol", companyId: "c_houzs", email: "carol@houzs.com", erpUserId: 3, active: false },
  ];
  const replay = planOrgSync(erp, { companies: afterCompanies, members: afterMembers });
  assert(replay.companies.insert.length === 0, "idempotent replay: no company inserts");
  assert(replay.companies.update.length === 0, "idempotent replay: no company updates");
  assert(replay.members.insert.length === 0, "idempotent replay: no member inserts");
  assert(replay.members.deactivate.length === 0, "idempotent replay: no new deactivations");
  // Updates are allowed on replay (field refresh) but must not duplicate rows.
  assert(replay.members.update.length === 4, `idempotent replay: expected 4 member updates, got ${replay.members.update.length}`);

  console.log("ORG-SYNC SMOKE PASS:");
  console.log(`  companies:  +${plan.companies.insert.length} insert, ~${plan.companies.update.length} update`);
  console.log(`  members:    +${plan.members.insert.length} insert, ~${plan.members.update.length} update, -${plan.members.deactivate.length} deactivate`);
  console.log(`  reconciled: alice by email -> erp_user_id 1`);
  console.log(`  idempotent replay: ${replay.members.update.length} updates, 0 inserts/deactivations`);

  // DB-backed ON CONFLICT regression (the partial-index 42P10 guard).
  await dbRegression();

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

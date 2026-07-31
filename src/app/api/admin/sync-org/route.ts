import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import {
  applyOrgSync,
  ensureErpOrgColumns,
  fetchErpOrg,
  loadExistingOrg,
  planOrgSync,
  summarizePlan,
} from "@/lib/sync/erp-org";

/**
 * POST /api/admin/sync-org — trigger the ERP -> Connect org mirror.
 *
 * Guard: header `x-sync-token` must equal env.SYNC_ADMIN_TOKEN (401 otherwise).
 * Query `?dryRun=1` (the DEFAULT) returns the computed diff WITHOUT writing;
 * `?dryRun=0` applies it and returns the applied counts.
 *
 * Config (env / Worker secrets):
 *   ERP_API_BASE       default https://erp.houzscentury.com
 *   ERP_SERVICE_TOKEN  shared Bearer the ERP treats as a fail-open service user
 *   SYNC_ADMIN_TOKEN   the x-sync-token this route checks
 *
 *   curl -X POST -H "x-sync-token: <SYNC_ADMIN_TOKEN>" \
 *     "https://chat.houzscentury.com/api/admin/sync-org?dryRun=1"
 */
const DEFAULT_ERP_BASE = "https://erp.houzscentury.com";

export async function POST(req: NextRequest) {
  const { env } = getCloudflareContext();

  const adminToken = env.SYNC_ADMIN_TOKEN;
  const provided = req.headers.get("x-sync-token");
  // Constant-ish check; also fail if the secret isn't configured at all.
  if (!adminToken || provided !== adminToken) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const serviceToken = env.ERP_SERVICE_TOKEN;
  if (!serviceToken) {
    return NextResponse.json(
      { ok: false, error: "ERP_SERVICE_TOKEN is not configured" },
      { status: 500 }
    );
  }
  const base = env.ERP_API_BASE || DEFAULT_ERP_BASE;

  // dryRun defaults to true; only an explicit ?dryRun=0 applies writes.
  const dryRun = new URL(req.url).searchParams.get("dryRun") !== "0";

  try {
    const erp = await fetchErpOrg(base, serviceToken);
    const db = getDb();
    await ensureErpOrgColumns(db);
    const existing = await loadExistingOrg(db);
    const plan = planOrgSync(erp, existing);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        source: { base, companies: erp.companies.length, users: erp.users.length },
        summary: summarizePlan(plan),
        plan,
      });
    }

    const applied = await applyOrgSync(db, plan);
    return NextResponse.json({ ok: true, dryRun: false, applied });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "sync-org", hint: "POST with x-sync-token; ?dryRun=1 (default)" });
}

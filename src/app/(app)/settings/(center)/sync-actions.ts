"use server";

// Pull the ERP org into Connect on demand.
//
// The org chart (roles, departments, reporting) is mirrored ONLY by the full
// sync — login just upserts the one person signing in (see app/login/actions.ts,
// "Connect does not build an org chart here"). The token-guarded /api/admin/
// sync-org route runs the same steps for an operator with the admin token; this
// server action is the in-product equivalent for an owner/admin, using the
// Worker's own ERP service token so nobody has to handle a secret to refresh.

import { revalidatePath } from "next/cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import {
  applyOrgHierarchy,
  applyOrgSync,
  ensureErpOrgColumns,
  fetchErpOrg,
  loadExistingOrg,
  planOrgSync,
} from "@/lib/sync/erp-org";
import { isAdminRole } from "@/lib/permissions";
import { autoJoinDepartmentChannels } from "@/lib/internal-auto-join";

const DEFAULT_ERP_BASE = "https://erp.houzscentury.com";

export async function syncFromErp(): Promise<void> {
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) return;

  const { env } = getCloudflareContext();
  const token = env.ERP_SERVICE_TOKEN;
  // No service token configured (e.g. a preview without secrets) → do nothing
  // rather than throw a 500 into a form post.
  if (!token) return;
  const base = env.ERP_API_BASE || DEFAULT_ERP_BASE;

  const db = getDb();
  const erp = await fetchErpOrg(base, token);
  await ensureErpOrgColumns(db);
  const existing = await loadExistingOrg(db);
  const plan = planOrgSync(erp, existing);
  await applyOrgSync(db, plan);
  await applyOrgHierarchy(db, erp);
  // New hires and department moves land in their department's Internal channel.
  await autoJoinDepartmentChannels(null, true).catch((e) => console.warn("[sync] channel auto-join failed:", e));

  revalidatePath("/settings");
  revalidatePath("/inbox");
}

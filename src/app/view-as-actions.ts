"use server";

// Staging only: an admin looks at the app as another member without signing in
// as them. The choice is a cookie that lib/current-member.ts reads; it is only
// honoured on staging and only while the signed-in person is an admin, so a
// cookie carried to production, or set by anyone else, does nothing.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getSignedInMember, VIEW_AS_COOKIE } from "@/lib/current-member";
import { SESSION_COOKIE_OPTIONS } from "@/lib/erp-auth";
import { isAdminRole } from "@/lib/permissions";

async function signedInAdmin() {
  if (getCloudflareContext().env.CONNECT_STAGING !== "1") return null;
  const real = await getSignedInMember();
  return real && isAdminRole(real.role) ? real : null;
}

export async function viewAs(formData: FormData) {
  const real = await signedInAdmin();
  if (!real) return;
  const id = String(formData.get("memberId") ?? "");
  const jar = await cookies();
  if (!id || id === real.id) {
    jar.delete(VIEW_AS_COOKIE);
  } else {
    const target = await getDb().query.member.findFirst({
      columns: { id: true },
      where: and(eq(member.id, id), eq(member.companyId, real.companyId), eq(member.active, true)),
    });
    if (!target) return;
    jar.set(VIEW_AS_COOKIE, target.id, SESSION_COOKIE_OPTIONS);
  }
  // Home, not the current page: the person viewed as may not open the page you were on.
  redirect("/");
}

export async function stopViewAs() {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/");
}

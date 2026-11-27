import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "@/lib/erp-auth";
import { isAdminRole } from "@/lib/permissions";
import { isAccessRemoved } from "@/lib/team-access";

/** Cookie holding the member id an admin is viewing as. Read only on staging. */
export const VIEW_AS_COOKIE = "connect_view_as";

/**
 * The member the app acts as: the signed-in member, or on staging the person
 * an admin chose to "view as" from the banner (app/view-as-actions.ts). Every
 * page, menu and permission check reads this, so viewing as a driver shows
 * exactly what that driver gets.
 *
 * Memoised per request with React's `cache()`. A single render calls this from
 * the layout, from `PageChrome`, from the page body and from each streamed
 * section; without memoisation that is one signature verification and one
 * `member` round-trip each time, on the critical path.
 */
export const getCurrentMember = cache(async () => {
  const real = await getSignedInMember();
  if (!real) return null;
  return (await viewAsTarget(real)) ?? real;
});

/**
 * The person who actually signed in, resolved from the session cookie (set at
 * ERP login), ignoring "view as". Null when there's no valid session — the
 * (app) layout redirects to /login in that case.
 */
export const getSignedInMember = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { env } = getCloudflareContext();
  const secret = env.SESSION_SECRET;
  if (!secret) return null;

  const memberId = await verifySession(token, secret);
  if (!memberId) return null;

  const db = getDb();
  const m = await db.query.member.findFirst({
    where: eq(member.id, memberId),
    with: { department: true },
  });
  // Company access taken away on the Team page ends a session standing in it.
  if (!m || !m.active) return null;
  // Access removed on the Team page: signed out everywhere, not just at the next sign-in.
  if (await isAccessRemoved(db, m.email)) return null;
  return m;
});

type Member = NonNullable<Awaited<ReturnType<typeof getSignedInMember>>>;

/** Who `real` is viewing as, or null. Never on production, never for a non-admin. */
async function viewAsTarget(real: Member): Promise<Member | null> {
  if (getCloudflareContext().env.CONNECT_STAGING !== "1" || !isAdminRole(real.role)) return null;
  const id = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!id || id === real.id) return null;
  const m = await getDb().query.member.findFirst({
    where: eq(member.id, id),
    with: { department: true },
  });
  return m && m.active ? m : null;
}

export type CurrentMember = NonNullable<Awaited<ReturnType<typeof getCurrentMember>>>;

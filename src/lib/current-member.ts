import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "@/lib/erp-auth";
import { isAccessRemoved } from "@/lib/team-access";

/**
 * The signed-in member, resolved from the session cookie (set at ERP login).
 * Returns null when there's no valid session — the (app) layout redirects to
 * /login in that case, so authenticated pages always receive a real member.
 *
 * Memoised per request with React's `cache()`. A single render calls this from
 * the layout, from `PageChrome`, from the page body and from each streamed
 * section; without memoisation that is one signature verification and one
 * `member` round-trip each time, on the critical path.
 */
export const getCurrentMember = cache(async () => {
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
  if (!m) return null;
  // Access removed on the Team page: signed out everywhere, not just at the next sign-in.
  if (await isAccessRemoved(db, m.email)) return null;
  return m;
});

export type CurrentMember = NonNullable<Awaited<ReturnType<typeof getCurrentMember>>>;

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "@/lib/erp-auth";

/**
 * The signed-in member, resolved from the session cookie (set at ERP login).
 * Returns null when there's no valid session — the (app) layout redirects to
 * /login in that case, so authenticated pages always receive a real member.
 */
export async function getCurrentMember() {
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
  return m ?? null;
}

export type CurrentMember = NonNullable<Awaited<ReturnType<typeof getCurrentMember>>>;

import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";

const COOKIE = "hc_member";

/**
 * Dev-mode "act as" member. Real auth (ERP SSO) comes in Phase 5.
 * Falls back to the OWNER so the app always renders.
 */
export async function getCurrentMember() {
  const db = getDb();
  const jar = await cookies();
  const wantId = jar.get(COOKIE)?.value;

  if (wantId) {
    const m = await db.query.member.findFirst({
      where: eq(member.id, wantId),
      with: { department: true },
    });
    if (m) return m;
  }
  const fallback = await db.query.member.findFirst({
    where: eq(member.role, "OWNER"),
    with: { department: true },
    orderBy: asc(member.createdAt),
  });
  if (fallback) return fallback;

  // Absolute last resort (empty DB).
  const any = await db.query.member.findFirst({ with: { department: true } });
  if (!any) throw new Error("No members in database");
  return any;
}

export type CurrentMember = Awaited<ReturnType<typeof getCurrentMember>>;

export const MEMBER_COOKIE = COOKIE;

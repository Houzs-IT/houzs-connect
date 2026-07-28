import { cookies } from "next/headers";
import { db } from "./db";

const COOKIE = "hc_member";

/**
 * Dev-mode "act as" member. Real auth (ERP SSO) comes in Phase 5.
 * Falls back to the OWNER so the app always renders.
 */
export async function getCurrentMember() {
  const jar = await cookies();
  const wantId = jar.get(COOKIE)?.value;

  if (wantId) {
    const m = await db.member.findUnique({
      where: { id: wantId },
      include: { department: true },
    });
    if (m) return m;
  }
  const fallback = await db.member.findFirst({
    where: { role: "OWNER" },
    include: { department: true },
    orderBy: { createdAt: "asc" },
  });
  if (fallback) return fallback;

  // Absolute last resort (empty DB).
  return db.member.findFirstOrThrow({ include: { department: true } });
}

export const MEMBER_COOKIE = COOKIE;

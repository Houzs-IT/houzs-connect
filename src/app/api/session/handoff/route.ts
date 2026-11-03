// GET /api/session/handoff?t=<pass>&next=/inbox — arriving on another
// company's address after switching company (CONNECT-0003, app/company-actions.ts).
// The pass (lib/erp-auth.ts signHandoff) lives one minute and names one member
// row; this signs that row in on THIS address and goes on to the page. A bad,
// stale or removed pass lands on the sign-in page instead.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { SESSION_COOKIE, signSession, verifyHandoff } from "@/lib/erp-auth";
import { isAccessRemoved } from "@/lib/team-access";

export async function GET(req: NextRequest) {
  // From the address the browser asked for: under `next dev`, req.url carries
  // the server's own hostname (localhost), not hookka.localhost.
  const here = `${req.nextUrl.protocol}//${req.headers.get("host") ?? req.nextUrl.host}`;
  const login = new URL("/login", here);
  const secret = getCloudflareContext().env.SESSION_SECRET;
  const memberId = secret ? await verifyHandoff(req.nextUrl.searchParams.get("t") ?? "", secret) : null;
  if (!secret || !memberId) return NextResponse.redirect(login);

  const db = getDb();
  const m = await db.query.member.findFirst({ columns: { id: true, email: true, active: true }, where: eq(member.id, memberId) });
  if (!m?.active || (await isAccessRemoved(db, m.email))) return NextResponse.redirect(login);

  // Only a page of this app, never another site.
  const next = req.nextUrl.searchParams.get("next") ?? "";
  const res = NextResponse.redirect(new URL(/^\/[a-z-]+$/.test(next) ? next : "/inbox", here));
  res.cookies.set(SESSION_COOKIE, await signSession(m.id, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  // The pass rides in the address; keep it out of any page the browser might share.
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

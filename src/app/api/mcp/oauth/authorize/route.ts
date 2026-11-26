import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { MCP_RETURN_COOKIE, originFor } from "@/lib/mcp/core";
import { consentPage, decideConsent, expiredPage, startAuthorize } from "@/lib/mcp/oauth";
import { companyName } from "@/lib/mcp/reads";
import { getAuthRequest, mcpDb } from "@/lib/mcp/store";

// The AI Connector's authorize step. An AI app's redirect is validated and parked
// as a 10-minute pending request (?request=mcpa_…); the person signs in to Connect
// with their own account if needed (login/actions.ts brings them back here) and
// gets an Allow / Cancel page rendered on the server.
export const dynamic = "force-dynamic";

const REQUEST_ID = /^mcpa_[A-Za-z0-9_-]{10,64}$/;

/** Not signed in: remember the pending request for ten minutes and go to the sign-in page. */
function toLogin(origin: string, requestId: string, status: 302 | 303) {
  const res = NextResponse.redirect(`${origin}/login`, status);
  res.cookies.set(MCP_RETURN_COOKIE, requestId, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

export async function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const origin = originFor(req.headers.get("host"), req.url);
  const resume = url.searchParams.get("request");
  if (resume !== null) {
    if (!REQUEST_ID.test(resume)) return expiredPage();
    await mcpDb(db);
    if (!(await getAuthRequest(db, resume))) return expiredPage();
    const me = await getCurrentMember();
    if (!me) return toLogin(origin, resume, 302);
    return consentPage(db, resume, me, await companyName(db, me.companyId));
  }
  const s = await startAuthorize(db, url);
  if (s.kind === "error") return s.response;
  return NextResponse.redirect(`${origin}/api/mcp/oauth/authorize?request=${encodeURIComponent(s.requestId)}`, 302);
}

export async function POST(req: Request) {
  const db = getDb();
  const origin = originFor(req.headers.get("host"), req.url);
  // The decision is a same-site form post. The session cookie is SameSite=Lax,
  // so a cross-site post carries no session anyway; refuse it outright too.
  // `Origin: null` (privacy mode, or an older page served with no-referrer) is allowed only when the browser
  // itself says the post came from this same site.
  const from = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const nullOk = from === "null" && (site === "same-origin" || site === "none");
  if ((from && from !== origin && !nullOk) || site === "cross-site" || site === "same-site") {
    return new Response("Forbidden\n", { status: 403, headers: { "Content-Type": "text/plain" } });
  }
  const fd = await req.formData().catch(() => null);
  const requestId = String(fd?.get("request") ?? "");
  const decision = String(fd?.get("decision") ?? "");
  if (!REQUEST_ID.test(requestId)) return expiredPage();
  const me = await getCurrentMember();
  if (!me) return toLogin(origin, requestId, 303);
  return decideConsent(db, requestId, decision === "allow", me);
}

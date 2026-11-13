// Open a unified-inbox thread that belongs to another company.
//
// The rail of a unified inbox (lib/inbox-group.ts) lists threads of every
// company in the person's group, but everything you DO on a thread — reply,
// assign, tag, push a payment — is scoped to the signed-in company and checks
// it. Rather than loosen those checks, opening another company's thread signs
// the session into the person's member row in THAT company first, then lands on
// the thread, where every action runs exactly as it would after a manual
// company switch. A route handler, because only a handler or a server action can
// write the cookie; the rail links here with a plain <a> so the whole shell
// re-renders as the new company.
//
// The only company it will switch into is one inboxScopes() already grants —
// an active member row of the same person in the same group — so a hand-made
// link cannot reach a company the ERP never granted.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { conversation } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, signSession } from "@/lib/erp-auth";
import { inboxScopes } from "@/lib/inbox-group";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url));

  const me = await getCurrentMember();
  if (!me) return go("/login");

  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, id),
    columns: { id: true },
    with: { contact: { columns: { companyId: true } } },
  });
  if (!convo) return go("/inbox");

  const target = `/inbox/${convo.id}${req.nextUrl.search}`;
  // Already in the right company (a double click, or a stale rail row).
  if (convo.contact.companyId === me.companyId) return go(target);

  const scope = (await inboxScopes(db, me)).find((s) => s.companyId === convo.contact.companyId);
  const secret = getCloudflareContext().env.SESSION_SECRET;
  // Not a company this person may open — back to their own inbox, never to the
  // thread (which would 404 and then bounce here again).
  if (!scope || !secret) return go("/inbox");

  const res = go(target);
  res.cookies.set(SESSION_COOKIE, await signSession(scope.memberId, secret), SESSION_COOKIE_OPTIONS);
  return res;
}

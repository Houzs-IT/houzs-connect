import { getDb } from "@/db/client";
import { escapeHtml, mytNow } from "@/lib/mcp/proactive";
import { logSend, UNSUB_TOKEN_RE, unsubscribeWithToken } from "@/lib/mcp/proactive-store";

// The unsubscribe link in every morning brief / alert email (AI Connector round
// 4d). No sign-in: the random token alone identifies the person. GET shows ONE
// button; only the POST turns anything off — a link scanner that pre-opens every
// link in an email (Outlook Safe Links, Gmail) must not unsubscribe anyone.
export const dynamic = "force-dynamic";

function page(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1B1E24">
<main style="max-width:480px;margin:48px auto;padding:24px;background:#fff;border:1px solid #E2E5EA;border-radius:12px;box-sizing:border-box;width:calc(100% - 32px)">${inner}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}

const invalid = () =>
  page("Link not valid", `<h1 style="font-size:20px;margin:0 0 8px">This link is not valid</h1><p style="color:#4E5560">Change your email settings on Settings › AI Connector in Houzs Connect.</p>`, 400);

export function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!UNSUB_TOKEN_RE.test(t)) return invalid();
  return page(
    "Unsubscribe",
    `<h1 style="font-size:20px;margin:0 0 8px">Stop Houzs Connect emails?</h1><p style="color:#4E5560">This turns off your morning brief and urgent alerts. You can turn them on again on Settings › AI Connector.</p>
<form method="post" action="/api/mcp/unsubscribe"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit" style="height:44px;padding:0 20px;border:0;border-radius:8px;background:#1F5FAD;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`
  );
}

export async function POST(req: Request) {
  let t = new URL(req.url).searchParams.get("t") ?? "";
  if (!t) {
    const form = await req.formData().catch(() => null);
    const v = form?.get("t");
    t = typeof v === "string" ? v : "";
  }
  if (!UNSUB_TOKEN_RE.test(t)) return invalid();
  const db = getDb();
  const who = await unsubscribeWithToken(db, t);
  if (!who) return invalid();
  await logSend(db, { memberId: who.memberId, email: who.email, kind: "unsubscribe", day: mytNow().day, items: 0, providerId: null, status: "skipped", note: "unsubscribed by email link" });
  return page(
    "Unsubscribed",
    `<h1 style="font-size:20px;margin:0 0 8px">You are unsubscribed</h1><p style="color:#4E5560">No more morning briefs or alerts. Turn them on again any time on Settings › AI Connector.</p>`
  );
}

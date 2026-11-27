import { getCloudflareContext } from "@opennextjs/cloudflare";
import { annotatedHtml, verifyShotLink } from "@/lib/mcp/howto-shots";

// show_me's 15-minute annotated picture (AI Connector round 5b, src/lib/mcp/howto-shots.ts):
// the demo-data screenshot with a red box and an arrow drawn in CSS. The page, label
// and expiry are signed (HMAC-SHA256, SESSION_SECRET); the box comes from the
// captured data, never from the URL. No Connect data is read.
export const dynamic = "force-dynamic";

const plain = (msg: string, status: number) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const secret = (getCloudflareContext().env as unknown as { SESSION_SECRET?: string }).SESSION_SECRET ?? "";
  if (!secret) return plain("Not available here.\n", 404);
  const url = new URL(req.url);
  const hit = await verifyShotLink(url.searchParams, secret);
  if (hit === "expired") return plain("This picture link has expired (15 minutes). Ask the AI to show it again.\n", 410);
  if (hit === "invalid") return plain("This picture link is not valid.\n", 400);
  return new Response(annotatedHtml(hit, `/help-shots/${encodeURIComponent(hit.shot.file)}`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

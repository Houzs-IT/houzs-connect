import { protectedResourceMetadata, CORS_HEADERS, originFor } from "@/lib/mcp/core";

// OAuth discovery for the AI Connector, at the site root (RFC 9728 / RFC 8414),
// with or without a resource path suffix (e.g. /.well-known/oauth-protected-resource/api/mcp).
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(JSON.stringify(protectedResourceMetadata(originFor(req.headers.get("host"), req.url))), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...CORS_HEADERS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

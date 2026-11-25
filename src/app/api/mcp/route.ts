import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { originFor } from "@/lib/mcp/core";
import { CORS_HEADERS, handleMcpPost } from "@/lib/mcp/server";

// The AI Connector (MCP Streamable HTTP, stateless). Read-only by construction:
// see src/lib/mcp/server.ts. The connector token is accepted here and nowhere else.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // The call log is written after the answer (waitUntil), on the same request's socket.
  const defer = (p: Promise<unknown>) => {
    try {
      getCloudflareContext().ctx.waitUntil(p);
    } catch {
      // not inside a Worker request (never in production): the write still runs, unawaited
    }
  };
  return handleMcpPost(getDb(), req, originFor(req.headers.get("host"), req.url), defer);
}

// Stateless server: no server-initiated stream, no sessions to end.
export function GET() {
  return new Response(JSON.stringify({ error: "Use POST (MCP Streamable HTTP)." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS_HEADERS } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

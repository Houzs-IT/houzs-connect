import { getDb } from "@/db/client";
import { handleToken } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/server";

// OAuth token endpoint for the AI Connector: authorization_code (PKCE S256) and
// rotating refresh_token. Public clients, no client secret.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleToken(getDb(), req);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

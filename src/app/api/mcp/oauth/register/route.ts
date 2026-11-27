import { getDb } from "@/db/client";
import { handleRegister } from "@/lib/mcp/oauth";
import { CORS_HEADERS } from "@/lib/mcp/server";

// OAuth dynamic client registration for the AI Connector (public clients, PKCE).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleRegister(getDb(), req);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

import { CORS_HEADERS } from "@/lib/mcp/core";
import { EXPORT_TOKEN, exportBucket, exportKey } from "@/lib/mcp/export-store";
import { XLSX_TYPE } from "@/lib/mcp/xlsx";

// export_excel downloads (src/lib/mcp/server.ts): the 15-minute link the tool
// hands back. The random token in the path is the only key; its SHA-256 names
// the R2 object (src/lib/mcp/export-store.ts).
export const dynamic = "force-dynamic";

const gone = () =>
  new Response("This download link has expired. Ask the AI for the export again.\n", {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS },
  });

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!EXPORT_TOKEN.test(token)) return gone();
  const bucket = exportBucket();
  if (!bucket) return gone();
  const obj = await bucket.get(await exportKey(token));
  if (!obj) return gone();
  const exp = Date.parse(obj.customMetadata?.expiresAt ?? "");
  if (!Number.isFinite(exp) || exp < Date.now()) return gone();
  const name = (obj.customMetadata?.fileName ?? "export.xlsx").replace(/[^A-Za-z0-9._-]/g, "");
  return new Response(obj.body, {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

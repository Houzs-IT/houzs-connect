import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel, contact } from "@/db/schema";
import { authenticate, unauthorized } from "@/lib/api-keys";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";

/**
 * POST /api/v1/messages — send an approved template to an existing contact.
 *
 *   { "phone": "60123456789", "template": "delivery_date_confirm",
 *     "language": "en", "params": ["Wong", "znt5961"], "body": "optional text shown in the inbox" }
 *
 * Templates only: outside the 24-hour window Meta refuses anything else, and a
 * system sending on its own is by definition business-initiated. The contact
 * must already exist in this company; blocked contacts are refused.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  let input: { phone?: string; template?: string; language?: string; params?: unknown; body?: string };
  try {
    input = await req.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const phone = String(input.phone ?? "").replace(/\D/g, "");
  const template = String(input.template ?? "").trim();
  if (!phone || !template) return Response.json({ error: "phone and template are required." }, { status: 400 });
  const params = Array.isArray(input.params) ? input.params.map((p) => String(p)) : [];

  const db = getDb();
  const who = await db.query.contact.findFirst({ where: and(eq(contact.companyId, auth.companyId), eq(contact.phone, phone)) });
  if (!who) return Response.json({ error: "No contact with that phone in this company." }, { status: 404 });
  const ch = await db.query.channel.findFirst({
    where: eq(channel.companyId, auth.companyId),
    orderBy: [desc(channel.isDefault), asc(channel.displayName)],
  });
  if (!ch) return Response.json({ error: "This company has no WhatsApp number." }, { status: 409 });

  const convo = await getOrCreateConversation(ch.id, who.id);
  const shown = String(input.body ?? "").trim() || `[template ${template}] ${params.join(" · ")}`.trim();
  const msg = await sendOutbound(convo.id, shown, {
    isBot: true,
    type: "TEMPLATE",
    template: { name: template, lang: String(input.language ?? "en"), params },
  });
  if (!msg) return Response.json({ error: "This contact is blocked." }, { status: 409 });
  const row = await db.query.message.findFirst({ where: (m, { eq: e }) => e(m.id, msg.id) });
  return Response.json(
    { id: msg.id, conversationId: convo.id, status: row?.status ?? msg.status, waMessageId: row?.waMessageId ?? null },
    { status: row?.status === "FAILED" ? 502 : 201 }
  );
}

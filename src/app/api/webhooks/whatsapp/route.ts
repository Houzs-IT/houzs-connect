import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrCreateConversation, recordInbound } from "@/lib/whatsapp/transport";
import { handleInboundMessage } from "@/lib/automation/dispatch";

/**
 * Meta WhatsApp Cloud API webhook.
 * - GET: verification handshake (Meta sends hub.challenge on subscribe).
 * - POST: inbound messages (text / interactive button taps) and delivery statuses.
 * Active in LIVE; harmless in DEMO (no traffic). Set WHATSAPP_VERIFY_TOKEN.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: Array<{
    from: string;
    id: string;
    type: string;
    text?: { body: string };
    interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  }>;
  statuses?: Array<{ id: string; status: string }>;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    entry?: { changes?: { value?: WaValue }[] }[];
  } | null;
  if (!body?.entry) return NextResponse.json({ ok: true });

  // Single-tenant resolve: first company + its default channel. Multi-tenant would map
  // value.metadata.phone_number_id -> Channel.
  const company = await db.company.findFirst({ orderBy: { createdAt: "asc" } });
  const channel = company
    ? await db.channel.findFirst({ where: { companyId: company.id }, orderBy: { isDefault: "desc" } })
    : null;

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Delivery/read statuses -> update our message row.
      for (const s of value.statuses ?? []) {
        const map: Record<string, string> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
        const status = map[s.status];
        if (status) {
          await db.message.updateMany({
            where: { waMessageId: s.id },
            data: { status: status as "SENT" | "DELIVERED" | "READ" | "FAILED" },
          });
        }
      }

      if (!company || !channel) continue;

      const nameByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const phone = m.from.replace(/[^\d]/g, "");
        const contact = await db.contact.upsert({
          where: { companyId_phone: { companyId: company.id, phone } },
          update: {},
          create: { companyId: company.id, phone, name: nameByWaId.get(m.from) ?? null, source: "whatsapp" },
        });
        const convo = await getOrCreateConversation(channel.id, contact.id);

        const buttonId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
        const text = m.text?.body ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";

        await recordInbound(convo.id, text, {
          type: buttonId ? "INTERACTIVE" : "TEXT",
          interactivePayload: buttonId ? { tapped: buttonId } : undefined,
        });
        await handleInboundMessage(contact.id, buttonId ? { buttonId } : { text });
      }
    }
  }
  return NextResponse.json({ ok: true });
}

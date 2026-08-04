import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  channel as channelTable,
  contact as contactTable,
  message as messageTable,
} from "@/db/schema";
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

  const db = getDb();

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Delivery/read statuses -> update our message row. Keyed by waMessageId, so
      // it needs no channel/company context.
      for (const s of value.statuses ?? []) {
        const map: Record<string, string> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
        const status = map[s.status];
        if (status) {
          await db
            .update(messageTable)
            .set({ status: status as "SENT" | "DELIVERED" | "READ" | "FAILED" })
            .where(eq(messageTable.waMessageId, s.id));
        }
      }

      // MULTI-TENANT ROUTING. The number that RECEIVED this message identifies which
      // company owns the conversation: map value.metadata.phone_number_id -> the
      // channel that carries it -> its company. This replaces the old single-tenant
      // "first company + default channel" resolve, so a message to company A's number
      // lands in company A's inbox, scoped to company A's contacts.
      const phoneNumberId = value.metadata?.phone_number_id;
      const channel = phoneNumberId
        ? await db.query.channel.findFirst({
            where: eq(channelTable.phoneNumberId, phoneNumberId),
          })
        : null;
      if (!channel) {
        // No channel is bound to this number yet — don't guess a company (that would
        // cross-tenant-leak the contact). Statuses above are already handled.
        if (value.messages?.length) {
          console.warn("WA_INBOUND_NO_CHANNEL", { phoneNumberId });
        }
        continue;
      }
      const companyId = channel.companyId;

      const nameByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const phone = m.from.replace(/[^\d]/g, "");
        const [contact] = await db
          .insert(contactTable)
          .values({
            companyId,
            phone,
            name: nameByWaId.get(m.from) ?? null,
            source: "whatsapp",
          })
          .onConflictDoUpdate({
            target: [contactTable.companyId, contactTable.phone],
            set: { phone }, // no-op keep; forces the existing row to be returned
          })
          .returning();
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

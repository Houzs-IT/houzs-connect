import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  channel as channelTable,
  company as companyTable,
  contact as contactTable,
  message as messageTable,
  webhookEvent,
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
  const raw = await req.text().catch(() => "");
  const body = (() => {
    try {
      return JSON.parse(raw) as { entry?: { changes?: { value?: WaValue }[] }[] } | null;
    } catch {
      return null;
    }
  })();

  const db = getDb();

  // Record EVERY delivery before interpreting it. Without this the only way to
  // tell "Meta never called us" from "Meta called and we dropped it" was to
  // guess — the handler used to return 200 and write nothing on any payload it
  // could not resolve to a channel. System Logs reads these rows.
  const logged = await db
    .insert(webhookEvent)
    .values({
      source: "whatsapp",
      eventType: body?.entry?.[0]?.changes?.[0]?.value?.messages?.length
        ? "message"
        : body?.entry?.[0]?.changes?.[0]?.value?.statuses?.length
          ? "status"
          : "unknown",
      payload: (body ?? { unparseable: raw.slice(0, 2000) }) as object,
      processed: false,
    })
    .returning({ id: webhookEvent.id })
    .catch(() => [] as { id: string }[]);
  const eventId = logged[0]?.id ?? null;

  /** Stamp the outcome onto the row so the log says what we DID with it. */
  const finish = async (note: string, processed: boolean) => {
    if (!eventId) return;
    await db
      .update(webhookEvent)
      .set({ processed, eventType: note })
      .where(eq(webhookEvent.id, eventId))
      .catch(() => {});
  };

  if (!body?.entry) {
    await finish("ignored:no-entry", false);
    return NextResponse.json({ ok: true });
  }

  // Single-tenant resolve: first company + its default channel. Routing by
  // value.metadata.phone_number_id is what a second WABA needs, and there is
  // already a branch for it (feat/multi-tenant-channels) — not tonight's change.
  const company = await db.query.company.findFirst({ orderBy: asc(companyTable.createdAt) });
  const channel = company
    ? await db.query.channel.findFirst({
        where: eq(channelTable.companyId, company.id),
        orderBy: desc(channelTable.isDefault),
      })
    : null;

  if (!company || !channel) {
    // The silent drop that made this undiagnosable. Now it is a log line.
    await finish(
      company ? "dropped:no-channel-for-company" : "dropped:no-company",
      false
    );
    return NextResponse.json({ ok: true });
  }

  let handled = 0;
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Delivery/read statuses -> update our message row.
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

      const nameByWaId = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const phone = m.from.replace(/[^\d]/g, "");
        const [contact] = await db
          .insert(contactTable)
          .values({
            companyId: company.id,
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
        handled++;
      }
    }
  }
  await finish(handled > 0 ? `handled:${handled}-message(s)` : "handled:status-only", true);
  return NextResponse.json({ ok: true });
}

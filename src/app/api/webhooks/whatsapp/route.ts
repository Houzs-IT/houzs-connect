import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureContactColumns } from "@/db/ensure";
import {
  contact as contactTable,
  message as messageTable,
  payment as paymentTable,
  webhookEvent,
} from "@/db/schema";
import { attrs } from "@/lib/format";
import { getOrCreateConversation, recordInbound } from "@/lib/whatsapp/transport";
import { handleInboundMessage } from "@/lib/automation/dispatch";
import { loadRoutingTable, pickInboundChannel } from "@/lib/whatsapp/channels";
import { maybeAutoReply } from "@/lib/auto-reply/run";
import { mustRefuse, signatureState, type SignatureState } from "@/lib/whatsapp/signature";

/**
 * Whether signature enforcement has armed (see mustRefuse): some delivery in the
 * last 30 days verified against the configured secret. Remembered per isolate
 * once true — it never un-arms on its own.
 */
let armed = false;
async function signatureArmed(db: ReturnType<typeof getDb>): Promise<boolean> {
  if (armed) return true;
  const rows = await db
    .select({ id: webhookEvent.id })
    .from(webhookEvent)
    .where(
      sql`${webhookEvent.source} = 'whatsapp' and ${webhookEvent.eventType} like '%|sig:valid' and ${webhookEvent.createdAt} > now() - interval '30 days'`
    )
    .limit(1)
    .catch(() => []);
  armed = rows.length > 0;
  return armed;
}

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
  // A sender is identified by wa_id (a phone number) OR, since WhatsApp
  // usernames shipped, by user_id ("MY.3816205081852835") with NO phone number
  // anywhere in the payload. Both shapes arrive on the same webhook.
  contacts?: {
    wa_id?: string;
    user_id?: string;
    profile?: { name?: string; username?: string };
  }[];
  messages?: Array<{
    from?: string;
    from_user_id?: string;
    id: string;
    type: string;
    text?: { body: string };
    // A customer sending a payment slip arrives as an image: no text, just a
    // media id to fetch from the Graph API (plus an optional caption).
    image?: { id?: string; mime_type?: string; caption?: string };
    document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
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

  // Contact columns that may not exist in Postgres yet (see db/ensure.ts).
  // Drizzle selects the full column list, so without this a deploy that lands
  // before the migration drops customer messages on the floor — the one failure
  // mode here that loses data rather than showing an error page.
  await ensureContactColumns(db).catch(() => {});

  // Did Meta send this? (src/lib/whatsapp/signature.ts) A forged delivery is
  // refused before it can reach an inbox or trigger an automatic reply — once a
  // real delivery has proven the configured secret right.
  const sig: SignatureState = await signatureState(
    raw,
    req.headers.get("x-hub-signature-256"),
    process.env.WHATSAPP_APP_SECRET
  );
  if (sig === "valid") armed = true;
  if (mustRefuse(sig, await signatureArmed(db))) {
    // The forged body is not kept: it is not a customer's, and storing it
    // would hand the sender a way to write into System Logs.
    await db
      .insert(webhookEvent)
      .values({ source: "whatsapp", eventType: `rejected:signature-${sig}`, payload: { bytes: raw.length }, processed: false })
      .catch(() => {});
    return NextResponse.json({ ok: false }, { status: 401 });
  }

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
      // "|sig:valid" on a real delivery is also what arms enforcement.
      .set({ processed, eventType: sig === "off" ? note : `${note}|sig:${sig}` })
      .where(eq(webhookEvent.id, eventId))
      .catch(() => {});
  };

  if (!body?.entry) {
    await finish("ignored:no-entry", false);
    return NextResponse.json({ ok: true });
  }

  // Which company a message belongs to is decided by the number it was SENT TO:
  // value.metadata.phone_number_id -> the channel holding that number -> its
  // company. One account carries several companies' numbers, so the channel is
  // picked per change, never once per request; the table itself is a handful of
  // rows and is read once. Delivery statuses need none of this — they match our
  // own message row by Meta's message id.
  const routing = await loadRoutingTable(db).catch(() => null);
  if (!routing) {
    await finish("failed:routing-table-unreadable", false);
    // Non-2xx so Meta retries: this is our failure, and the message is not lost.
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let handled = 0;
  const refused: string[] = [];
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

      const receivingId = value.metadata?.phone_number_id ?? null;
      const channel = pickInboundChannel(routing, receivingId);
      if (!channel) {
        // A number nobody has assigned to a company. Filing it under a guessed
        // company is how one company's customers end up in another's inbox, so
        // it is refused — the raw delivery is already in webhook_event above, and
        // the number shows as "not assigned" on Settings → Phone numbers.
        if (value.messages?.length) refused.push(receivingId ?? "no-number");
        continue;
      }

      const nameById = new Map(
        (value.contacts ?? [])
          .map((c) => [c.wa_id ?? c.user_id, c.profile?.name ?? c.profile?.username] as const)
          .filter(([id]) => !!id) as [string, string | undefined][]
      );
      for (const m of value.messages ?? []) {
        // `from` is a phone number; `from_user_id` is a WhatsApp username id and
        // is ALL we get for a username sender. Reading m.from blindly threw here
        // and took the whole delivery down — Meta then retried it four times.
        const senderId = m.from ?? m.from_user_id;
        if (!senderId) continue;
        // Keep a phone number as digits (that is the key contacts are stored by
        // and the value Cloud API takes back as `to`); keep a user id verbatim,
        // because stripping its non-digits would destroy the identifier.
        const phone = m.from ? m.from.replace(/[^\d]/g, "") : senderId;
        const [contact] = await db
          .insert(contactTable)
          .values({
            companyId: channel.companyId,
            phone,
            name: nameById.get(senderId) ?? null,
            source: "whatsapp",
          })
          .onConflictDoUpdate({
            target: [contactTable.companyId, contactTable.phone],
            set: { phone }, // no-op keep; forces the existing row to be returned
          })
          .returning();
        const convo = await getOrCreateConversation(channel.id, contact.id);

        const buttonId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
        const media = m.image ?? m.document;
        const isMedia = m.type === "image" || m.type === "document";
        const text =
          m.text?.body ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          media?.caption ??
          (isMedia ? "[attachment]" : "");

        const inbound = await recordInbound(convo.id, text, {
          type: isMedia ? (m.type === "document" ? "DOCUMENT" : "IMAGE") : buttonId ? "INTERACTIVE" : "TEXT",
          interactivePayload: buttonId
            ? { tapped: buttonId }
            : media?.id
              ? { mediaId: media.id, mimeType: media.mime_type }
              : undefined,
        });

        if (isMedia) {
          // A customer sending an image is, in this business, almost always a
          // payment slip — that is the whole balance-collection flow. We cannot
          // read the amount off it: runOcr() parses TEXT, and what arrives here
          // is a Graph API media id. Rather than drop it (which is what used to
          // happen — the image became an empty text message and no payment row
          // was ever created), record a PENDING payment carrying the media id so
          // it surfaces on /payments for a human to verify.
          await db.insert(paymentTable).values({
            contactId: contact.id,
            conversationId: convo.id,
            amount: null,
            method: null,
            referenceNo: null,
            orderRef: (attrs(contact.attributes).ref_1 as string) ?? null,
            receiptMediaUrl: media?.id ? `whatsapp-media:${media.id}` : null,
            ocrRawText: media?.caption ?? null,
            status: "PENDING",
          });
        }

        const flows = await handleInboundMessage(contact.id, buttonId ? { buttonId } : { text });

        // The company's welcome / away message — only when no automation took
        // this message, so a greeting never lands in the middle of a flow that is
        // waiting on the customer. Never allowed to fail the delivery: the
        // customer's message is already saved.
        if (flows.resumed === 0 && flows.started === 0) {
          await maybeAutoReply(db, {
            conversationId: convo.id,
            companyId: channel.companyId,
            inboundMessageId: inbound.id,
          }).catch((e) => console.error("AUTO_REPLY_FAIL", e));
        }
        handled++;
      }
    }
  }
  await finish(
    refused.length
      ? `dropped:number-not-assigned:${[...new Set(refused)].join(",")}${handled ? `;handled:${handled}-message(s)` : ""}`
      : handled > 0
        ? `handled:${handled}-message(s)`
        : "handled:status-only",
    refused.length === 0
  );
  return NextResponse.json({ ok: true });
}

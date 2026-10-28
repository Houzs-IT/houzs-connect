import { intakeReceipt } from "@/lib/receipt-intake";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureContactColumns } from "@/db/ensure";
import {
  contact as contactTable,
  message as messageTable,
  webhookEvent,
} from "@/db/schema";
import { attrs } from "@/lib/format";
import { getOrCreateConversation, recordInbound } from "@/lib/whatsapp/transport";
import { handleInboundMessage } from "@/lib/automation/dispatch";
import { loadRoutingTable, pickInboundChannel } from "@/lib/whatsapp/channels";
import { maybeAutoReply } from "@/lib/auto-reply/run";
import { mustRefuse, signatureState, type SignatureState } from "@/lib/whatsapp/signature";
import { MEDIA_TYPE, describeNonText } from "@/lib/whatsapp/inbound-text";

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
    interactive?: {
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string };
      // A WhatsApp Flow (form) submission: response_json is a JSON string of the
      // collected { field_key: value } pairs.
      nfm_reply?: { response_json?: string; name?: string };
    };
    // A quick-reply button tapped on an approved TEMPLATE arrives top-level with
    // type "button" — NOT as interactive.button_reply. Without this, Confirm /
    // Amend taps on a delivery/amend opener (the only way those first messages can
    // be sent business-initiated) are dropped and the run never resumes.
    button?: { payload?: string; text?: string };
    audio?: { id?: string; mime_type?: string; voice?: boolean };
    video?: { id?: string; mime_type?: string; caption?: string };
    sticker?: { id?: string; mime_type?: string; animated?: boolean };
    location?: { latitude?: number; longitude?: number; name?: string; address?: string };
    contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string; wa_id?: string }> }>;
    reaction?: { message_id?: string; emoji?: string };
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

  // Acknowledge FIRST, process AFTER. Meta expects a 2xx within seconds and
  // redelivers otherwise; a tap that opens a run sends templates, forms and the
  // ERP callback before the loop ends, which is longer than that. The work
  // continues under waitUntil (the Worker keeps running after the response);
  // outside the Worker (tests, scripts) it simply runs inline.
  const entries = body.entry;
  const work = (async () => {
  let handled = 0;
  let duplicates = 0;
  const refused: string[] = [];
  for (const entry of entries) {
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
        // Meta REDELIVERS a message whenever it does not get a 2xx fast enough
        // (seen live 2026-10-06: one Confirm / Amend tap arrived three times,
        // 24 s apart, and each copy advanced the flow again — the customer got
        // the reason prompt twice and the run jumped a branch). The id is the
        // same on every copy, so a message already on file is acknowledged and
        // skipped; the first copy's processing, not this one, owns the reply.
        if (m.id) {
          const seen = await db.query.message.findFirst({ where: eq(messageTable.waMessageId, m.id) });
          if (seen) {
            duplicates++;
            continue;
          }
        }
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

        // An interactive reply's id, or a template quick-reply's payload (its
        // text if no payload was set — an empty payload falls through to it).
        const buttonId =
          m.interactive?.button_reply?.id ??
          m.interactive?.list_reply?.id ??
          (m.button?.payload || m.button?.text);
        // A WhatsApp Flow (form) submission arrives as interactive.nfm_reply with
        // the collected fields JSON-encoded in response_json.
        const flowReply = m.interactive?.nfm_reply;
        const flowFields: Record<string, string> | null = flowReply?.response_json
          ? (() => {
              try {
                const obj = JSON.parse(flowReply.response_json!) as Record<string, unknown>;
                const out: Record<string, string> = {};
                for (const [k, v] of Object.entries(obj)) {
                  if (k === "flow_token") continue; // Meta's bookkeeping, not a field
                  if (v != null) out[k] = String(v);
                }
                return out;
              } catch {
                return null;
              }
            })()
          : null;
        const media = m.image ?? m.document ?? m.video ?? m.audio ?? m.sticker;
        const caption = m.image?.caption ?? m.document?.caption ?? m.video?.caption;
        const isMedia = m.type === "image" || m.type === "document";
        const mediaType = MEDIA_TYPE[m.type];
        const text =
          m.text?.body ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          m.button?.text ??
          (flowFields ? "[form submitted]" : null) ??
          caption ??
          (isMedia ? "[attachment]" : "");

        // Flows still get `text` exactly as before: a sticker or a reaction is
        // not an answer to "why do you want to postpone?".
        const inbound = await recordInbound(convo.id, text || describeNonText(m), {
          waMessageId: m.id ?? null,
          type: mediaType ?? (buttonId || flowFields ? "INTERACTIVE" : "TEXT"),
          interactivePayload: flowFields
            ? { kind: "flow_reply", fields: flowFields }
            : buttonId
              ? { tapped: buttonId }
              : media?.id
                ? { mediaId: media.id, mimeType: media.mime_type }
                : undefined,
        });

        if (isMedia) {
          // An image may be a payment slip — or a poster, a product photo, a
          // chat screenshot. Claude reads it and only a picture showing a paid
          // amount becomes a payment to check (lib/receipt-intake.ts).
          await intakeReceipt({
            contactId: contact.id,
            conversationId: convo.id,
            orderRef: (attrs(contact.attributes).ref_1 as string) ?? null,
            mediaId: media?.id ?? null,
            caption: caption ?? null,
          });
        }

        const flows = await handleInboundMessage(
          contact.id,
          flowFields ? { flow: { fields: flowFields } } : buttonId ? { buttonId } : { text }
        );

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
  const dup = duplicates ? `;duplicate:${duplicates}` : "";
  await finish(
    refused.length
      ? `dropped:number-not-assigned:${[...new Set(refused)].join(",")}${handled ? `;handled:${handled}-message(s)` : ""}${dup}`
      : handled > 0
        ? `handled:${handled}-message(s)${dup}`
        : duplicates
          ? `handled:duplicate-only${dup}`
          : "handled:status-only",
    refused.length === 0
  );
  })().catch(async (e) => {
    console.error("WEBHOOK_WORK_FAIL", e);
    await finish(`failed:${String((e as Error)?.message ?? e).slice(0, 120)}`, false).catch(() => {});
  });
  try {
    getCloudflareContext().ctx.waitUntil(work);
  } catch {
    await work;
  }
  return NextResponse.json({ ok: true });
}

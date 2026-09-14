// Which channel a WhatsApp number belongs to, in both directions — the pure half.
//
// One WhatsApp Business Account can carry several numbers — Houzs Century's and
// Hookka's today — and each belongs to its own company. Meta tells us which
// number a delivery arrived on (value.metadata.phone_number_id) and needs to be
// told which number to send from ({phone-number-id}/messages). The channel row's
// `phone_number_id` is the bridge for both, so a Hookka customer lands in
// Hookka's inbox and is answered from Hookka's number.
//
// THE ONE LEGACY CASE. Before channels carried an id, the webhook filed every
// message under the first company's default channel and every send used the
// WHATSAPP_PHONE_NUMBER_ID secret. That channel still has no id of its own on
// production, and the Houzs number has been live on it since August. So until
// someone assigns that number explicitly, the default sender keeps meaning that
// channel — in both directions — and nothing that works today stops working on
// deploy. Every OTHER unassigned number is refused rather than guessed: filing it
// under a company it may not belong to is exactly the leak this exists to prevent.
//
// No imports on purpose: scripts/smoke-channel-routing.mjs pins these decisions
// without a database. The reads that feed them live in ./channels.ts.

export interface RoutingChannel {
  id: string;
  companyId: string;
  phoneNumberId: string | null;
}

export interface RoutingTable<C extends RoutingChannel = RoutingChannel> {
  channels: C[];
  /** The first company's default channel — what the old resolver always picked. */
  legacyChannelId: string | null;
  /** WHATSAPP_PHONE_NUMBER_ID, the number the app ran on before channels had ids. */
  defaultSenderId: string | null;
}

/**
 * The legacy channel may speak for the default number only while no channel has
 * claimed that number explicitly and it has no id of its own. Once the number is
 * assigned anywhere, the assignment wins and the fallback switches itself off.
 */
function legacyCovers<C extends RoutingChannel>(t: RoutingTable<C>): C | null {
  if (!t.legacyChannelId || !t.defaultSenderId) return null;
  if (t.channels.some((c) => c.phoneNumberId === t.defaultSenderId)) return null;
  const legacy = t.channels.find((c) => c.id === t.legacyChannelId);
  return legacy && !legacy.phoneNumberId ? legacy : null;
}

/** The channel a delivery to `receivingId` belongs to, or null to refuse it. */
export function pickInboundChannel<C extends RoutingChannel>(
  t: RoutingTable<C>,
  receivingId: string | null | undefined
): C | null {
  if (!receivingId) return null;
  const assigned = t.channels.find((c) => c.phoneNumberId === receivingId);
  if (assigned) return assigned;
  return receivingId === t.defaultSenderId ? legacyCovers(t) : null;
}

/** The number a channel sends from, or null when it has none. */
export function senderIdForChannel<C extends RoutingChannel>(
  t: RoutingTable<C>,
  channelId: string
): string | null {
  const ch = t.channels.find((c) => c.id === channelId);
  if (!ch) return null;
  if (ch.phoneNumberId) return ch.phoneNumberId;
  return legacyCovers(t)?.id === ch.id ? t.defaultSenderId : null;
}

/** The channel (if any) a WABA number is assigned to, and whether only by legacy. */
export function channelForNumber<C extends RoutingChannel>(
  t: RoutingTable<C>,
  phoneNumberId: string
): { channel: C; legacy: boolean } | null {
  const assigned = t.channels.find((c) => c.phoneNumberId === phoneNumberId);
  if (assigned) return { channel: assigned, legacy: false };
  const legacy = phoneNumberId === t.defaultSenderId ? legacyCovers(t) : null;
  return legacy ? { channel: legacy, legacy: true } : null;
}

export const UNASSIGNED_SENDER =
  "This conversation's channel has no WhatsApp number assigned, so there is nothing to send it from. Assign the number to its company on Settings → Phone numbers.";

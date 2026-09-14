// The reads behind channel routing. The decisions are in ./channel-routing.ts.

import { asc, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { channel, company } from "@/db/schema";
import { ensureChannelColumns } from "@/db/ensure-channel";
import { senderIdForChannel } from "./channel-routing";

export {
  channelForNumber,
  pickInboundChannel,
  senderIdForChannel,
  UNASSIGNED_SENDER,
  type RoutingChannel,
  type RoutingTable,
} from "./channel-routing";

/**
 * Everything routing needs, in three small reads. Channels are a handful of rows
 * (one per number), so loading them all beats a lookup per message.
 */
export async function loadRoutingTable(db: DB) {
  await ensureChannelColumns(db);
  const channels = await db.query.channel.findMany({
    columns: {
      id: true,
      companyId: true,
      phoneNumberId: true,
      displayName: true,
      phone: true,
      isDefault: true,
    },
  });
  const first = await db.query.company.findFirst({
    columns: { id: true },
    orderBy: asc(company.createdAt),
  });
  const legacy = first
    ? await db.query.channel.findFirst({
        columns: { id: true },
        where: eq(channel.companyId, first.id),
        orderBy: desc(channel.isDefault),
      })
    : undefined;
  return {
    channels,
    legacyChannelId: legacy?.id ?? null,
    defaultSenderId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
  };
}

/** The number to send a channel's messages from, or null (see UNASSIGNED_SENDER). */
export async function senderForChannel(db: DB, channelId: string): Promise<string | null> {
  return senderIdForChannel(await loadRoutingTable(db), channelId);
}

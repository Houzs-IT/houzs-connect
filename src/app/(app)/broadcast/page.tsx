import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { PageChrome } from "@/components/PageChrome";
import { listBroadcastContacts, listCampaignTemplates } from "../campaigns/actions";
import { BroadcastClient } from "./BroadcastClient";

// The address book and the approved-template list are both remote state that
// changes under the page — never serve a broadcast picker from a cache.
export const dynamic = "force-dynamic";

/**
 * Broadcast: hand-pick contacts and send one approved template to all of them
 * at once. It is the StreamHost-style "message these guests" flow, built on the
 * same send engine the Campaigns wizard uses — a broadcast is just a campaign
 * whose audience is a list of ids (see audience.ts `kind: "ids"`), so there is
 * one sender, one set of stats, one place a message can go wrong.
 */
export default async function BroadcastPage() {
  const me = await getCurrentMember();
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login
  const db = getDb();
  const [book, templates, channels] = await Promise.all([
    listBroadcastContacts(),
    listCampaignTemplates(),
    db.query.channel.findMany({
      where: eq(channel.companyId, me.companyId),
      orderBy: desc(channel.isDefault),
    }),
  ]);
  const ch = channels[0];
  return (
    <PageChrome section="broadcast">
      <BroadcastClient
        contacts={book.contacts}
        tags={book.tags}
        templates={templates}
        channelLabel={ch ? `${ch.displayName} (${ch.phone})` : ""}
        live={isLive()}
      />
    </PageChrome>
  );
}

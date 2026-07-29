"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  campaign as campaignTable,
  channel as channelTable,
  contact as contactTable,
  contactTag as contactTagTable,
  tag as tagTable,
} from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";
import { interpolate } from "@/lib/automation/vars";

/**
 * Create a broadcast campaign and send it to the resolved audience (DEMO transport).
 * Audience = "all" contacts in the company, or those carrying a given tag. Message
 * supports {full_name}/{ref_1}/... merge vars per contact.
 */
export async function createAndSendCampaign(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const audience = String(formData.get("audience") ?? "all");
  const message = String(formData.get("message") ?? "").trim();
  if (!name || !message) return;

  const db = getDb();
  const me = await getCurrentMember();
  const channel = await db.query.channel.findFirst({
    where: eq(channelTable.companyId, me.companyId),
    orderBy: desc(channelTable.isDefault),
  });
  if (!channel) return;

  // Resolve audience: all company contacts, or those carrying the named tag.
  let contacts;
  if (audience === "all") {
    contacts = await db.query.contact.findMany({
      where: eq(contactTable.companyId, me.companyId),
    });
  } else {
    const tagRow = await db.query.tag.findFirst({
      where: and(eq(tagTable.companyId, me.companyId), eq(tagTable.name, audience)),
    });
    const links = tagRow
      ? await db.query.contactTag.findMany({ where: eq(contactTagTable.tagId, tagRow.id) })
      : [];
    const contactIds = links.map((l) => l.contactId);
    contacts = contactIds.length
      ? await db.query.contact.findMany({
          where: and(
            eq(contactTable.companyId, me.companyId),
            inArray(contactTable.id, contactIds)
          ),
        })
      : [];
  }

  const [campaign] = await db
    .insert(campaignTable)
    .values({
      companyId: me.companyId,
      channelId: channel.id,
      name,
      audience: { kind: audience === "all" ? "all" : "tag", value: audience },
      status: "running",
      stats: { total: contacts.length, sent: 0 },
    })
    .returning();

  let sent = 0;
  for (const c of contacts) {
    const convo = await getOrCreateConversation(channel.id, c.id);
    await sendOutbound(
      convo.id,
      interpolate(message, { full_name: c.name, phone: c.phone, attributes: c.attributes }),
      { isBot: true, type: "TEMPLATE" }
    );
    sent++;
  }

  await db
    .update(campaignTable)
    .set({ status: "completed", stats: { total: contacts.length, sent } })
    .where(eq(campaignTable.id, campaign.id));

  revalidatePath("/campaigns");
  revalidatePath("/inbox");
}

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
import { attrs } from "@/lib/format";

/**
 * Create a one-time broadcast campaign and (unless scheduled for later) send it
 * to the resolved audience via the DEMO transport.
 *
 * Audience is one of:
 *   - all       → every contact in the company
 *   - tag       → contacts carrying the named tag
 *   - attribute → contacts whose custom attribute `key` equals `value`
 *
 * Scheduling: when the caller picks "send later" with a future timestamp the
 * campaign is stored with status "scheduled" and NOT sent — a future dispatcher
 * (or the LIVE Cloud API worker) would pick scheduled rows up. Send-now runs the
 * dispatch inline exactly as before. Message body supports {var}/{{var}} merge.
 */
export async function createAndSendCampaign(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const audienceKind = String(formData.get("audienceKind") ?? "all");
  const audienceTag = String(formData.get("audienceTag") ?? "");
  const attrKey = String(formData.get("attrKey") ?? "").trim();
  const attrValue = String(formData.get("attrValue") ?? "").trim();
  const templateName = String(formData.get("templateName") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const scheduleMode = String(formData.get("scheduleMode") ?? "now");
  const scheduleAtRaw = String(formData.get("scheduleAt") ?? "").trim();
  if (!name || !message) return;

  const db = getDb();
  const me = await getCurrentMember();
  if (!me) return;
  const channel = await db.query.channel.findFirst({
    where: eq(channelTable.companyId, me.companyId),
    orderBy: desc(channelTable.isDefault),
  });
  if (!channel) return;

  // ── Resolve audience ──
  let contacts;
  let audienceMeta: Record<string, string>;
  if (audienceKind === "tag" && audienceTag) {
    const tagRow = await db.query.tag.findFirst({
      where: and(eq(tagTable.companyId, me.companyId), eq(tagTable.name, audienceTag)),
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
    audienceMeta = { kind: "tag", value: audienceTag };
  } else if (audienceKind === "attribute" && attrKey) {
    // Attribute filter: pull company contacts and match on the JSON attribute.
    // Filtering in JS keeps this portable (attributes is a free-form jsonb map).
    const all = await db.query.contact.findMany({
      where: eq(contactTable.companyId, me.companyId),
    });
    contacts = all.filter((c) => {
      const v = attrs(c.attributes)[attrKey];
      if (v == null) return false;
      return attrValue === "" ? true : String(v).toLowerCase() === attrValue.toLowerCase();
    });
    audienceMeta = {
      kind: "attribute",
      value: attrValue ? `${attrKey} = ${attrValue}` : `has ${attrKey}`,
    };
  } else {
    contacts = await db.query.contact.findMany({
      where: eq(contactTable.companyId, me.companyId),
    });
    audienceMeta = { kind: "all", value: "all" };
  }

  // ── Schedule vs send-now ──
  const scheduleAt =
    scheduleMode === "later" && scheduleAtRaw ? new Date(scheduleAtRaw) : null;
  const scheduledForFuture = !!scheduleAt && scheduleAt.getTime() > Date.now();

  const [created] = await db
    .insert(campaignTable)
    .values({
      companyId: me.companyId,
      channelId: channel.id,
      name,
      templateName: templateName || null,
      audience: audienceMeta,
      scheduleAt: scheduledForFuture ? scheduleAt : null,
      status: scheduledForFuture ? "scheduled" : "sending",
      stats: { total: contacts.length, sent: 0, delivered: 0, read: 0, replied: 0 },
    })
    .returning();

  // Scheduled campaigns are left for a dispatcher — do not send inline.
  if (scheduledForFuture) {
    revalidatePath("/campaigns");
    return;
  }

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
    .set({ status: "completed", stats: { total: contacts.length, sent, delivered: 0, read: 0, replied: 0 } })
    .where(eq(campaignTable.id, created.id));

  revalidatePath("/campaigns");
  revalidatePath("/inbox");
}

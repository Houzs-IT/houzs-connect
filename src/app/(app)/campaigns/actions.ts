"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
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

  const me = await getCurrentMember();
  const channel = await db.channel.findFirst({
    where: { companyId: me.companyId },
    orderBy: { isDefault: "desc" },
  });
  if (!channel) return;

  // Resolve audience.
  const where =
    audience === "all"
      ? { companyId: me.companyId }
      : {
          companyId: me.companyId,
          tagLinks: { some: { tag: { name: audience } } },
        };
  const contacts = await db.contact.findMany({ where });

  const campaign = await db.campaign.create({
    data: {
      companyId: me.companyId,
      channelId: channel.id,
      name,
      audience: { kind: audience === "all" ? "all" : "tag", value: audience },
      status: "running",
      stats: { total: contacts.length, sent: 0 },
    },
  });

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

  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "completed", stats: { total: contacts.length, sent } },
  });

  revalidatePath("/campaigns");
  revalidatePath("/inbox");
}

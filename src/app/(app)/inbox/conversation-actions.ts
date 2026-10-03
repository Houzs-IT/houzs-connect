"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { channel, contact, conversation } from "@/db/schema";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";

/**
 * Start (or reopen) a conversation with a contact by sending an approved
 * template — the only thing WhatsApp delivers to someone who has not written
 * in the last 24 hours. Uses the company's default number; an existing open
 * conversation with the contact is reused rather than duplicated.
 */
export async function startConversation(formData: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "forbidden" };
  const contactId = String(formData.get("contactId") ?? "");
  const templateName = String(formData.get("templateName") ?? "").trim();
  const language = String(formData.get("language") ?? "en").trim() || "en";
  const preview = String(formData.get("preview") ?? "").trim();
  const params = String(formData.get("params") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!contactId || !templateName) return { ok: false, error: "missing" };

  const db = getDb();
  const target = await db.query.contact.findFirst({
    where: and(eq(contact.id, contactId), eq(contact.companyId, me.companyId)),
    columns: { id: true, blocked: true },
  });
  if (!target) return { ok: false, error: "forbidden" };
  if (target.blocked) return { ok: false, error: "blocked" };

  const ch = await db.query.channel.findFirst({
    where: eq(channel.companyId, me.companyId),
    orderBy: [desc(channel.isDefault), asc(channel.id)],
    columns: { id: true },
  });
  if (!ch) return { ok: false, error: "no_channel" };

  const convo = await getOrCreateConversation(ch.id, contactId);
  // A new conversation started by an agent is theirs to follow up.
  if (!convo.assignedAgentId) {
    await db.update(conversation).set({ assignedAgentId: me.id }).where(eq(conversation.id, convo.id));
  }
  const sent = await sendOutbound(convo.id, preview || `[template: ${templateName}]`, {
    isBot: false,
    sentByMemberId: me.id,
    type: "TEMPLATE",
    template: { name: templateName, lang: language, params },
  });
  if (!sent) return { ok: false, error: "not_sent" };
  revalidatePath("/inbox");
  return { ok: true, id: convo.id };
}

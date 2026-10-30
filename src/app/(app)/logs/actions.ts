"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { message } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { sendOutbound, type TemplateSend } from "@/lib/whatsapp/transport";

/**
 * Send a failed outbound message again, as a new message on the same
 * conversation. The failed row stays as the record of what went wrong.
 *
 * Text goes out as text (Meta refuses it outside the 24-hour window — the new
 * row then says so); a template goes out with the same name, language and
 * parameters it was first sent with. Media and buttons are not resent here.
 */
export async function resendMessage(messageId: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const db = getDb();
  const row = await db.query.message.findFirst({
    where: eq(message.id, messageId),
    with: { conversation: { with: { contact: true } } },
  });
  if (!row || row.conversation.contact.companyId !== me.companyId) return { ok: false, error: "Not found." };
  if (row.direction !== "OUT" || row.status !== "FAILED") return { ok: false, error: "Only a failed outgoing message can be sent again." };

  const payload = (row.interactivePayload ?? null) as { template?: TemplateSend; replyTo?: string } | null;
  const template = payload?.template;
  if (row.type === "TEMPLATE" && !template) {
    return { ok: false, error: "This template message was sent before Connect kept its details, so it cannot be repeated exactly. Send it again from the conversation." };
  }
  if (row.type !== "TEMPLATE" && row.type !== "TEXT") {
    return { ok: false, error: "Only text and template messages can be sent again from here." };
  }

  const sent = await sendOutbound(row.conversationId, row.body ?? "", {
    isBot: false,
    sentByMemberId: me.id,
    ...(template ? { type: "TEMPLATE" as const, template } : {}),
    replyTo: payload?.replyTo,
  });
  if (!sent) return { ok: false, error: "This customer is blocked, so nothing was sent." };
  revalidatePath("/logs");
  revalidatePath(`/inbox/${row.conversationId}`);
  return { ok: true, id: sent.id };
}

import { db } from "@/lib/db";
import { attrs } from "@/lib/format";
import { startRun, resumeRun } from "./engine";
import { getOrCreateConversation } from "@/lib/whatsapp/transport";

export interface ErpWebhookPayload {
  companySlug?: string;
  phone: string;
  name?: string;
  automation?: string; // trigger a specific automation by name (optional)
  attributes?: Record<string, string>;
}

/**
 * ERP → Houzs Connect. Upserts the contact (with order attributes) and fires the
 * matching WEBHOOK-triggered automation, which sends the first WhatsApp message.
 * This is the core seam that replaces Seampify's webhook + Google Apps Script.
 */
export async function handleErpWebhook(payload: ErpWebhookPayload) {
  const company = payload.companySlug
    ? await db.company.findUnique({ where: { slug: payload.companySlug } })
    : await db.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) return { ok: false, error: "no company" as const };

  const phone = payload.phone.replace(/[^\d]/g, "");

  // Upsert contact + merge incoming ERP attributes.
  const existing = await db.contact.findUnique({
    where: { companyId_phone: { companyId: company.id, phone } },
  });
  const mergedAttrs = { ...attrs(existing?.attributes), ...(payload.attributes ?? {}) };
  const contact = existing
    ? await db.contact.update({
        where: { id: existing.id },
        data: { attributes: mergedAttrs, name: payload.name ?? existing.name },
      })
    : await db.contact.create({
        data: {
          companyId: company.id,
          phone,
          name: payload.name ?? null,
          source: "erp",
          attributes: mergedAttrs,
        },
      });

  await db.webhookEvent.create({
    data: { source: "erp", eventType: payload.automation ?? "order_event", payload: payload as object },
  });

  // Find enabled WEBHOOK automations (optionally filtered by name).
  const automations = await db.automation.findMany({
    where: {
      companyId: company.id,
      enabled: true,
      triggerType: "WEBHOOK",
      ...(payload.automation ? { name: payload.automation } : {}),
    },
  });

  const runs: string[] = [];
  for (const a of automations) {
    const run = await startRun(a.id, contact.id);
    if (run) runs.push(run.id);
  }

  // Resolve the conversation that received the first message.
  let conversationId: string | null = null;
  if (automations[0]) {
    const convo = await getOrCreateConversation(automations[0].channelId, contact.id);
    conversationId = convo.id;
  }

  return {
    ok: true as const,
    contactId: contact.id,
    conversationId,
    triggered: automations.map((a) => a.name),
    runs,
  };
}

/**
 * Customer replied (free text or an interactive button tap). Resume any waiting
 * runs for this contact so the flow sends the corresponding next content.
 */
export async function handleCustomerReply(
  contactId: string,
  input: { buttonId?: string; text?: string }
) {
  const waiting = await db.automationRun.findMany({
    where: { contactId, status: "waiting" },
    orderBy: { updatedAt: "desc" },
  });
  for (const run of waiting) {
    await resumeRun(run.id, input);
  }
  return waiting.length;
}

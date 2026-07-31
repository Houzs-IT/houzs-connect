import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation as automationTable,
  automationRun as automationRunTable,
  company as companyTable,
  contact as contactTable,
  conversation as conversationTable,
  driverEvent as driverEventTable,
  member as memberTable,
  payment as paymentTable,
  webhookEvent,
} from "@/db/schema";
import { attrs } from "@/lib/format";
import { startRun, resumeRun } from "./engine";
import { getOrCreateConversation } from "@/lib/whatsapp/transport";
import { runOcr } from "@/lib/ocr";

export interface ErpWebhookPayload {
  companySlug?: string;
  phone: string;
  name?: string;
  automation?: string; // trigger a specific automation by name (optional)
  attributes?: Record<string, string>;
}

async function resolveCompany(companySlug?: string) {
  const db = getDb();
  return companySlug
    ? await db.query.company.findFirst({ where: eq(companyTable.slug, companySlug) })
    : await db.query.company.findFirst({ orderBy: asc(companyTable.createdAt) });
}

/**
 * ERP → Houzs Connect. Upserts the contact (with order attributes) and fires the
 * matching WEBHOOK-triggered automation, which sends the first WhatsApp message.
 * This is the core seam that replaces Seampify's webhook + Google Apps Script.
 */
export async function handleErpWebhook(payload: ErpWebhookPayload) {
  const db = getDb();
  const company = await resolveCompany(payload.companySlug);
  if (!company) return { ok: false, error: "no company" as const };

  const phone = payload.phone.replace(/[^\d]/g, "");

  // Upsert contact + merge incoming ERP attributes.
  const existing = await db.query.contact.findFirst({
    where: and(eq(contactTable.companyId, company.id), eq(contactTable.phone, phone)),
  });
  const mergedAttrs = { ...attrs(existing?.attributes), ...(payload.attributes ?? {}) };
  const contact = existing
    ? (
        await db
          .update(contactTable)
          .set({ attributes: mergedAttrs, name: payload.name ?? existing.name })
          .where(eq(contactTable.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(contactTable)
          .values({
            companyId: company.id,
            phone,
            name: payload.name ?? null,
            source: "erp",
            attributes: mergedAttrs,
          })
          .returning()
      )[0];

  await db.insert(webhookEvent).values({
    source: "erp",
    eventType: payload.automation ?? "order_event",
    payload: payload as object,
  });

  // The "Action Callback Id" the Sheet/ERP sends: `automation` is the canonical
  // field, but the live Apps Script sometimes flattens it as `attributes.status`.
  const callbackKey = payload.automation ?? payload.attributes?.status;

  // (1) WEBHOOK automations — matched by name (unchanged legacy behaviour).
  const webhookConds = [
    eq(automationTable.companyId, company.id),
    eq(automationTable.enabled, true),
    eq(automationTable.triggerType, "WEBHOOK"),
  ];
  if (payload.automation) webhookConds.push(eq(automationTable.name, payload.automation));
  const webhookAutomations = await db.query.automation.findMany({
    where: and(...webhookConds),
  });

  // (2) ACTION_CALLBACK automations — matched by the trigger's configured
  // callbackId (Seampify's "Action Callback Id Matches: <id>"). JSON-key match is
  // done in-app since the value lives inside triggerConfig jsonb. keywords is kept
  // as a fallback for older configs that stored a list instead of a single id.
  let callbackAutomations: typeof webhookAutomations = [];
  if (callbackKey) {
    const enabledCallbackAutos = await db.query.automation.findMany({
      where: and(
        eq(automationTable.companyId, company.id),
        eq(automationTable.enabled, true),
        eq(automationTable.triggerType, "ACTION_CALLBACK")
      ),
    });
    callbackAutomations = enabledCallbackAutos.filter((a) => {
      const cfg = (a.triggerConfig ?? {}) as { callbackId?: string; keywords?: string[] };
      if (cfg.callbackId && cfg.callbackId === callbackKey) return true;
      return Array.isArray(cfg.keywords) && cfg.keywords.includes(callbackKey);
    });
  }

  // A given automation is either WEBHOOK or ACTION_CALLBACK (distinct triggerType),
  // so the two sets never overlap.
  const automations = [...webhookAutomations, ...callbackAutomations];

  const runs: string[] = [];
  for (const a of webhookAutomations) {
    const run = await startRun(a.id, contact.id);
    if (run) runs.push(run.id);
  }
  // ACTION_CALLBACK: pass the matched callback id so a multi-entry flow starts
  // from the trigger node configured for exactly this callback.
  for (const a of callbackAutomations) {
    const run = await startRun(a.id, contact.id, { callbackId: callbackKey ?? undefined });
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

export interface DriverEventPayload {
  companySlug?: string;
  phone: string;
  event: "EN_ROUTE" | "ARRIVED" | "DELIVERED" | "FAILED";
  driverName?: string;
  carPlate?: string;
  eta?: string;
  orderRef?: string;
  attributes?: Record<string, string>;
}

// Driver event → the TMS status the customer/ERP should see.
const TMS_STATUS: Record<DriverEventPayload["event"], string> = {
  EN_ROUTE: "Out for delivery",
  ARRIVED: "Driver arrived",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
};

/**
 * Driver/TMS event → Connect. A driver marking en-route / arrived / delivered
 * triggers a DRIVER_EVENT automation that messages the customer, and bumps the
 * TMS status (written back to the contact + ERP via the flow's call_rest_api).
 */
export async function handleDriverEvent(payload: DriverEventPayload) {
  const db = getDb();
  const company = await resolveCompany(payload.companySlug);
  if (!company) return { ok: false, error: "no company" as const };

  const phone = payload.phone.replace(/[^\d]/g, "");
  const existing = await db.query.contact.findFirst({
    where: and(eq(contactTable.companyId, company.id), eq(contactTable.phone, phone)),
  });
  if (!existing) return { ok: false, error: "unknown contact" as const };

  const prevAttrs = attrs(existing.attributes);
  const orderRef = payload.orderRef ?? prevAttrs.ref_1 ?? null;

  // Stamp driver + TMS status onto the contact so the flow can interpolate them.
  const mergedAttrs: Record<string, string> = {
    ...prevAttrs,
    ...(payload.attributes ?? {}),
    driver_event: payload.event,
    tms_status: TMS_STATUS[payload.event],
    ...(payload.driverName ? { drivers_name: payload.driverName } : {}),
    ...(payload.carPlate ? { car_plate: payload.carPlate } : {}),
    ...(payload.eta ? { delivery_time: payload.eta } : {}),
  };
  await db
    .update(contactTable)
    .set({ attributes: mergedAttrs })
    .where(eq(contactTable.id, existing.id));

  // Record the driver event (attributed to a DRIVER member if one exists).
  const driver = await db.query.member.findFirst({
    where: and(eq(memberTable.companyId, company.id), eq(memberTable.role, "DRIVER")),
  });
  if (driver) {
    await db.insert(driverEventTable).values({
      driverId: driver.id,
      contactId: existing.id,
      orderRef,
      eventType: payload.event,
      payload: payload as object,
    });
  }

  const automations = await db.query.automation.findMany({
    where: and(
      eq(automationTable.companyId, company.id),
      eq(automationTable.enabled, true),
      eq(automationTable.triggerType, "DRIVER_EVENT")
    ),
  });
  const runs: string[] = [];
  for (const a of automations) {
    const run = await startRun(a.id, existing.id);
    if (run) runs.push(run.id);
  }

  return {
    ok: true as const,
    contactId: existing.id,
    tmsStatus: TMS_STATUS[payload.event],
    triggered: automations.map((a) => a.name),
    runs,
  };
}

/**
 * A customer sent a payment receipt. OCR it, record the Payment against the order,
 * auto-verify when the amount matches the order total, and fire PAYMENT_RECEIVED
 * automations. This is the "auto-capture receipt -> auto-record payment" flow.
 */
export async function handleReceipt(
  conversationId: string,
  receiptText: string,
  mediaUrl?: string
) {
  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversationTable.id, conversationId),
    with: { contact: true },
  });
  if (!convo) return { ok: false as const, error: "no conversation" };

  const ocr = runOcr(receiptText);
  const a = attrs(convo.contact.attributes);
  const orderTotal = Number(a.order_total ?? a.amount ?? NaN);
  // Auto-verify only when OCR read an amount that matches the order total.
  const verified =
    ocr.amount != null && Number.isFinite(orderTotal) && Math.abs(ocr.amount - orderTotal) < 0.01;

  const [payment] = await db
    .insert(paymentTable)
    .values({
      contactId: convo.contactId,
      conversationId,
      amount: ocr.amount,
      currency: ocr.currency,
      method: ocr.method,
      referenceNo: ocr.reference,
      orderRef: (a.ref_1 as string) ?? null,
      receiptMediaUrl: mediaUrl ?? null,
      ocrRawText: ocr.raw,
      status: verified ? "VERIFIED" : "PENDING",
    })
    .returning();

  const runs: string[] = [];
  const automations = await db.query.automation.findMany({
    where: and(
      eq(automationTable.companyId, convo.contact.companyId),
      eq(automationTable.enabled, true),
      eq(automationTable.triggerType, "PAYMENT_RECEIVED")
    ),
  });
  for (const auto of automations) {
    const run = await startRun(auto.id, convo.contactId);
    if (run) runs.push(run.id);
  }

  return { ok: true as const, paymentId: payment.id, amount: ocr.amount, status: payment.status, verified, runs };
}

/**
 * Customer replied (free text or an interactive button tap). Resume any waiting
 * runs for this contact so the flow sends the corresponding next content.
 */
export async function handleCustomerReply(
  contactId: string,
  input: { buttonId?: string; text?: string }
) {
  const db = getDb();
  const waiting = await db.query.automationRun.findMany({
    where: and(
      eq(automationRunTable.contactId, contactId),
      eq(automationRunTable.status, "waiting")
    ),
    orderBy: desc(automationRunTable.updatedAt),
  });
  for (const run of waiting) {
    await resumeRun(run.id, input);
  }
  return waiting.length;
}

/**
 * A customer message arrived (from the DEMO simulator or a real Meta webhook). Resume
 * any waiting runs first; if none were waiting, start the channel's NEW_INCOMING_MESSAGE
 * automations (Seampify's "customer messages us -> a flow fires"). Keyword/callback
 * matching lives inside each flow's trigger/router nodes.
 */
export async function handleInboundMessage(
  contactId: string,
  input: { buttonId?: string; text?: string }
) {
  const db = getDb();
  const resumed = await handleCustomerReply(contactId, input);
  if (resumed > 0) return { resumed, started: 0 };

  const contact = await db.query.contact.findFirst({
    where: eq(contactTable.id, contactId),
  });
  if (!contact) return { resumed: 0, started: 0 };
  const autos = await db.query.automation.findMany({
    where: and(
      eq(automationTable.companyId, contact.companyId),
      eq(automationTable.enabled, true),
      eq(automationTable.triggerType, "NEW_INCOMING_MESSAGE")
    ),
  });
  let started = 0;
  for (const a of autos) {
    // Don't stack a second concurrent run of the same automation on this contact.
    const active = await db.query.automationRun.findFirst({
      where: and(
        eq(automationRunTable.automationId, a.id),
        eq(automationRunTable.contactId, contactId),
        inArray(automationRunTable.status, ["running", "waiting"])
      ),
    });
    if (active) continue;
    const run = await startRun(a.id, contactId);
    if (run) started++;
  }
  return { resumed: 0, started };
}

/**
 * A tag was added to a contact (manually in the inbox, or by a flow's Add Tag
 * node). Fire the company's enabled TAG_ADDED automations whose trigger is
 * configured for this tag (empty keyword list = any tag). This is the dispatch
 * seam for Seampify's "When A Tag is Added" trigger, which previously had no
 * runtime path. Guards against stacking a second concurrent run per automation.
 */
export async function handleTagAdded(
  companyId: string,
  contactId: string,
  tagName: string
) {
  const db = getDb();
  const autos = await db.query.automation.findMany({
    where: and(
      eq(automationTable.companyId, companyId),
      eq(automationTable.enabled, true),
      eq(automationTable.triggerType, "TAG_ADDED")
    ),
  });
  let started = 0;
  for (const a of autos) {
    const cfg = (a.triggerConfig ?? {}) as { keywords?: string[] };
    const keywords = Array.isArray(cfg.keywords) ? cfg.keywords : [];
    // Empty keyword list = fire on any tag; otherwise only the configured tags.
    if (keywords.length > 0 && !keywords.includes(tagName)) continue;
    const active = await db.query.automationRun.findFirst({
      where: and(
        eq(automationRunTable.automationId, a.id),
        eq(automationRunTable.contactId, contactId),
        inArray(automationRunTable.status, ["running", "waiting"])
      ),
    });
    if (active) continue;
    const run = await startRun(a.id, contactId, { tag: tagName });
    if (run) started++;
  }
  return started;
}

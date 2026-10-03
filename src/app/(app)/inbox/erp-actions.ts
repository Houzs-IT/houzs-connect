"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { channel, company, contact, conversation, note } from "@/db/schema";
import { attrs } from "@/lib/format";
import { erpConfig, erpHeaders, forgetRef, ordersByRef, slipWindow } from "@/lib/erp/orders";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";

/*
  Service → ERP writes, and starting a conversation.

  recordErpPayment posts to the ERP's own payment route
  (POST /api/scm/mfg-sales-orders/:docNo/payments), so the payment lands in the
  ERP ledger, the GL and the AutoCount balance exactly as if Finance had keyed
  it. The service token holds `*`, which in the ERP would also bypass the
  14-day slip-date window — so that window is enforced HERE, before the call.
*/

type Result = { ok: true } | { ok: false; error: string };

const METHODS = ["transfer", "cash", "merchant"] as const;

/** A signed-in member, and the conversation must be in THEIR company. */
async function authorize(conversationId: string) {
  if (!conversationId) return null;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo || convo.contact.companyId !== me.companyId) return null;
  const co = await db.query.company.findFirst({
    where: eq(company.id, me.companyId),
    columns: { erpCompanyId: true },
  });
  return { me, db, convo, erpCompanyId: co?.erpCompanyId ?? null };
}

export async function recordErpPayment(formData: FormData): Promise<Result> {
  // A PR preview shares the production ERP; it must never write money there.
  if (process.env.CONNECT_PREVIEW === "1") return { ok: false, error: "preview" };

  const conversationId = String(formData.get("conversationId") ?? "");
  const docNo = String(formData.get("docNo") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/,/g, ""));
  const paidAt = String(formData.get("paidAt") ?? "");
  const method = String(formData.get("method") ?? "");
  const sub = String(formData.get("sub") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 80);

  const auth = await authorize(conversationId);
  if (!auth) return { ok: false, error: "forbidden" };
  const cfg = erpConfig();
  if (!cfg) return { ok: false, error: "erp_not_configured" };

  if (!(amount > 0) || amount > 10_000_000) return { ok: false, error: "bad_amount" };
  if (!(METHODS as readonly string[]).includes(method)) return { ok: false, error: "bad_method" };
  if ((method === "transfer" || method === "merchant") && !sub) return { ok: false, error: "sub_required" };

  // Same window the ERP enforces for everyone without the backdate right.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return { ok: false, error: "bad_date" };
  const { today, oldest } = slipWindow();
  if (paidAt > today || paidAt < oldest) return { ok: false, error: "date_out_of_window" };

  // The order must be one of THIS customer's — never an arbitrary doc number.
  const ref = attrs(auth.convo.contact.attributes).ref_1;
  if (!ref) return { ok: false, error: "no_order" };
  const lookup = await ordersByRef(ref, auth.erpCompanyId);
  if (!lookup.ok || !lookup.orders.some((o) => o.docNo === docNo)) return { ok: false, error: "no_order" };

  const amountSen = Math.round(amount * 100);
  const noteText = `Recorded in Houzs Connect by ${auth.me.name}${reference ? ` · ref ${reference}` : ""}`;
  let res: Response;
  try {
    res = await fetch(`${cfg.base}/api/scm/mfg-sales-orders/${encodeURIComponent(docNo)}/payments`, {
      method: "POST",
      headers: { ...erpHeaders(cfg.token, auth.erpCompanyId), "content-type": "application/json" },
      body: JSON.stringify({
        paidAt,
        method,
        amountSen,
        ...(method === "transfer" ? { onlineType: sub } : {}),
        ...(method === "merchant" ? { merchantProvider: sub } : {}),
        note: noteText,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, error: "erp_unreachable" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    return { ok: false, error: body.reason || body.error || `erp_${res.status}` };
  }

  // Leave a trace in the conversation for the next person who opens it.
  await auth.db.insert(note).values({
    conversationId,
    memberId: auth.me.id,
    body: `Payment RM ${amount.toFixed(2)} (${method}${sub ? ` · ${sub}` : ""}) recorded to ${docNo} in Houzs ERP, dated ${paidAt}${reference ? `, ref ${reference}` : ""}.`,
  });
  forgetRef(ref, auth.erpCompanyId);
  revalidatePath(`/inbox/${conversationId}`);
  return { ok: true };
}

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

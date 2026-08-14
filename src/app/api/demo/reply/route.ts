import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversation } from "@/db/schema";
import { recordInbound } from "@/lib/whatsapp/transport";
import { handleCustomerReply } from "@/lib/automation/dispatch";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { getCurrentMember } from "@/lib/current-member";

/**
 * DEMO only: simulate a customer replying / tapping a button, so interactive
 * automation flows can round-trip without a real WhatsApp number.
 * Body: { conversationId, buttonId?, buttonLabel?, text? }
 *
 * This route said "DEMO only" in a comment and enforced nothing — no auth, no
 * mode check. Fabricating an inbound reply resumes a waiting automation run,
 * and in LIVE that sends real WhatsApp messages and calls the owner's REST
 * endpoints. Both gates are real now.
 */
export async function POST(req: NextRequest) {
  if (isLive()) {
    return NextResponse.json(
      { ok: false, error: "Not available while WHATSAPP_MODE=LIVE." },
      { status: 403 }
    );
  }
  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { conversationId, buttonId, buttonLabel, text } = await req.json();
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "conversationId required" }, { status: 400 });
  }
  const db = getDb();
  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    with: { contact: true },
  });
  if (!convo || convo.contact.companyId !== me.companyId) {
    return NextResponse.json({ ok: false, error: "no conversation" }, { status: 404 });
  }

  // Record the customer's inbound message so it shows in the thread.
  await recordInbound(conversationId, buttonLabel ?? text ?? buttonId ?? "", {
    type: buttonId ? "INTERACTIVE" : "TEXT",
    interactivePayload: buttonId ? { tapped: buttonId } : undefined,
  });

  const resumed = await handleCustomerReply(convo.contactId, { buttonId, text });
  return NextResponse.json({ ok: true, resumedRuns: resumed });
}

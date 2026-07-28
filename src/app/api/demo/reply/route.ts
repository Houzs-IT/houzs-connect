import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordInbound } from "@/lib/whatsapp/transport";
import { handleCustomerReply } from "@/lib/automation/dispatch";

/**
 * DEMO only: simulate a customer replying / tapping a button, so interactive
 * automation flows can round-trip without a real WhatsApp number.
 * Body: { conversationId, buttonId?, buttonLabel?, text? }
 */
export async function POST(req: NextRequest) {
  const { conversationId, buttonId, buttonLabel, text } = await req.json();
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "conversationId required" }, { status: 400 });
  }
  const convo = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!convo) return NextResponse.json({ ok: false, error: "no conversation" }, { status: 404 });

  // Record the customer's inbound message so it shows in the thread.
  await recordInbound(conversationId, buttonLabel ?? text ?? buttonId ?? "", {
    type: buttonId ? "INTERACTIVE" : "TEXT",
    interactivePayload: buttonId ? { tapped: buttonId } : undefined,
  });

  const resumed = await handleCustomerReply(convo.contactId, { buttonId, text });
  return NextResponse.json({ ok: true, resumedRuns: resumed });
}

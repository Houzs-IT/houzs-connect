import { NextRequest, NextResponse } from "next/server";
import { handleErpWebhook, type ErpWebhookPayload } from "@/lib/automation/dispatch";

/**
 * ERP → Houzs Connect webhook. The ERP POSTs an order event here; we upsert the
 * contact and fire the matching WEBHOOK automation (which sends the first message).
 *
 * Example:
 *   curl -X POST /api/webhooks/erp -H 'content-type: application/json' -d '{
 *     "phone":"60123456789","name":"Wong","automation":"New Delivery Follow-up",
 *     "attributes":{"ref_1":"znt7001","amount":"1500","delivery_date_1":"2026/08/10"}}'
 */
export async function POST(req: NextRequest) {
  let body: ErpWebhookPayload;
  try {
    body = (await req.json()) as ErpWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!body?.phone) {
    return NextResponse.json({ ok: false, error: "phone required" }, { status: 400 });
  }

  const result = await handleErpWebhook(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "erp-webhook" });
}

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleErpWebhook, type ErpWebhookPayload } from "@/lib/automation/dispatch";
import { webhookAuth } from "@/lib/webhook-auth";

/**
 * ERP → Houzs Connect webhook. The ERP POSTs an order event here; we upsert the
 * contact and fire the matching WEBHOOK automation (which sends the first message).
 *
 * Auth: the caller must send the Worker secret ERP_WEBHOOK_SECRET as
 * `x-connect-key: <secret>` (or `Authorization: Bearer <secret>`); 401 otherwise.
 * If the secret is not set, every call is refused with 503 unless
 * WHATSAPP_MODE=DEMO (see src/lib/webhook-auth.ts).
 *
 * Example:
 *   curl -X POST https://chat.houzscentury.com/api/webhooks/erp \
 *     -H 'content-type: application/json' -H 'x-connect-key: <ERP_WEBHOOK_SECRET>' -d '{
 *     "phone":"60123456789","name":"Wong","automation":"New Delivery Follow-up",
 *     "attributes":{"ref_1":"znt7001","amount":"1500","delivery_date_1":"2026/08/10"}}'
 */
export async function POST(req: NextRequest) {
  const auth = await webhookAuth(
    req.headers,
    getCloudflareContext().env.ERP_WEBHOOK_SECRET,
    process.env.WHATSAPP_MODE
  );
  if (auth === "unconfigured") {
    console.error(
      "[webhooks/erp] ERP_WEBHOOK_SECRET is not set on the Worker — refusing every call. " +
        "Set it with `wrangler secret put ERP_WEBHOOK_SECRET`."
    );
    return NextResponse.json({ ok: false, error: "webhook auth not configured" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

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

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { handleDriverEvent, type DriverEventPayload } from "@/lib/automation/dispatch";
import { webhookAuth } from "@/lib/webhook-auth";

/**
 * Driver app / TMS → Houzs Connect. A driver marking en-route / arrived / delivered
 * fires a DRIVER_EVENT automation (messages the customer) and bumps the TMS status.
 *
 * Auth: the caller must send the Worker secret DRIVER_WEBHOOK_SECRET as
 * `x-connect-key: <secret>` (or `Authorization: Bearer <secret>`); 401 otherwise.
 * If the secret is not set, every call is refused with 503 unless
 * WHATSAPP_MODE=DEMO (see src/lib/webhook-auth.ts).
 *
 * Example:
 *   curl -X POST https://chat.houzscentury.com/api/webhooks/driver \
 *     -H 'content-type: application/json' -H 'x-connect-key: <DRIVER_WEBHOOK_SECRET>' -d '{
 *     "phone":"60127778888","event":"ARRIVED","driverName":"Ah Meng","carPlate":"WXY1234"}'
 */
export async function POST(req: NextRequest) {
  const auth = await webhookAuth(
    req.headers,
    getCloudflareContext().env.DRIVER_WEBHOOK_SECRET,
    process.env.WHATSAPP_MODE
  );
  if (auth === "unconfigured") {
    console.error(
      "[webhooks/driver] DRIVER_WEBHOOK_SECRET is not set on the Worker — refusing every call. " +
        "Set it with `wrangler secret put DRIVER_WEBHOOK_SECRET`."
    );
    return NextResponse.json({ ok: false, error: "webhook auth not configured" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: DriverEventPayload;
  try {
    body = (await req.json()) as DriverEventPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!body?.phone || !body?.event) {
    return NextResponse.json({ ok: false, error: "phone and event required" }, { status: 400 });
  }
  const result = await handleDriverEvent(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

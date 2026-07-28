import { NextRequest, NextResponse } from "next/server";
import { handleDriverEvent, type DriverEventPayload } from "@/lib/automation/dispatch";

/**
 * Driver app / TMS → Houzs Connect. A driver marking en-route / arrived / delivered
 * fires a DRIVER_EVENT automation (messages the customer) and bumps the TMS status.
 *
 * Example:
 *   curl -X POST /api/webhooks/driver -H 'content-type: application/json' -d '{
 *     "phone":"60127778888","event":"ARRIVED","driverName":"Ah Meng","carPlate":"WXY1234"}'
 */
export async function POST(req: NextRequest) {
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

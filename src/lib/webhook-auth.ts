import { NextRequest, NextResponse } from "next/server";

// Shared-secret guard for the ERP-facing webhooks (ERP / TMS -> Connect).
//
// /api/webhooks/erp and /api/webhooks/driver each fire a real WhatsApp send to a
// customer, so a caller has to prove it is our ERP and not just anyone who found
// the URL. The ERP sends the secret in the `X-Connect-Key` header; we compare it
// against CONNECT_WEBHOOK_KEY (env/secret) in constant time.
//
// Enforced ONLY when CONNECT_WEBHOOK_KEY is set. While it is unset the guard is a
// no-op, so deploying this changes nothing on its own — the auth is switched on by
// setting the secret on both sides, never by a code deploy, so ERP and Connect can
// adopt the key without a flag-day. (`/api/webhooks/whatsapp` is Meta-facing and
// keeps its own WHATSAPP_APP_SECRET signature check; it does not use this.)

export function requireConnectKey(req: NextRequest): NextResponse | null {
  const expected = process.env.CONNECT_WEBHOOK_KEY;
  if (!expected) return null; // not configured yet -> allow (rollout window)

  const provided = req.headers.get("x-connect-key") ?? "";
  // Constant-time compare, same shape as erp-auth.verifySession. Seeding diff with
  // the length XOR folds the length check in without an early return, so a
  // wrong-length key is not distinguishable by timing; charCodeAt past the end is
  // NaN, which is 0 in a bitwise XOR, so a short key still mismatches.
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

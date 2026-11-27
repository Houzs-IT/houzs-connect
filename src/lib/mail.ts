// Connect's own email sender (AI Connector round 4d: morning brief + alerts).
//
// Connect had no mail provider before this (it messages customers over
// WhatsApp only). The brief is built and sent per person here, so Connect sends
// through the SAME provider and domain as the Houzs ERP Mail Center and HRIS
// (HRIS PR #115): Resend, from hello@houzscentury.com (already verified there).
//
//   RESEND_API_KEY   secret  (`wrangler secret put RESEND_API_KEY`)
//   BRIEF_MAIL_FROM  var     "Houzs Connect <hello@houzscentury.com>" (wrangler.toml)
//
// Not configured = nothing is sent: Settings -> AI Connector says so, and the
// scheduler skips the proactive sweep. A preview / staging Worker
// (CONNECT_PREVIEW=1) never sends. The caller logs each send
// (proactive-store.logSend) without the body.

import { rawFetch } from "./raw-fetch";

export type MailEnv = { RESEND_API_KEY?: string; BRIEF_MAIL_FROM?: string; CONNECT_PREVIEW?: string };
export type MailMessage = { to: string; subject: string; html: string; text: string };
export type MailResult = { ok: true; id: string } | { ok: false; error: string };

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

/** Why mail is off, in words — or null when it is on. Never names the key's value. */
export function mailOffReason(env: MailEnv): string | null {
  if (env.CONNECT_PREVIEW === "1") return "This is a preview / staging copy of Houzs Connect: it never sends email.";
  if (!(env.RESEND_API_KEY ?? "").trim()) return "Email is not set up on Houzs Connect yet (the RESEND_API_KEY secret is missing), so nothing is sent.";
  if (!/@/.test(env.BRIEF_MAIL_FROM ?? "")) return "Email is not set up on Houzs Connect yet (BRIEF_MAIL_FROM is missing), so nothing is sent.";
  return null;
}

export const mailConfigured = (env: MailEnv): boolean => mailOffReason(env) === null;

export async function sendMail(env: MailEnv, m: MailMessage, fetcher: typeof fetch = rawFetch()): Promise<MailResult> {
  const off = mailOffReason(env);
  if (off) return { ok: false, error: "email not configured" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.to)) return { ok: false, error: "no valid email address" };
  let res: Response;
  try {
    res = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${(env.RESEND_API_KEY ?? "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.BRIEF_MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `provider unreachable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
  if (!res.ok) return { ok: false, error: `provider ${res.status}${typeof body?.message === "string" ? `: ${body.message}` : ""}`.slice(0, 200) };
  return { ok: true, id: typeof body?.id === "string" ? body.id : "" };
}

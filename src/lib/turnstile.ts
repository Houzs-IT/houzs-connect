// Cloudflare Turnstile server-side verification.
//
// The login form carries a `cf-turnstile-response` token (from the widget in
// LoginView). The login action calls this before checking the password; a
// missing/invalid/already-used token fails the login. Enforced only when
// TURNSTILE_SECRET_KEY is set on the Worker — so an env without the secret
// (e.g. a bare local run) still works.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteip?: string | null
): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteip) body.set("remoteip", remoteip);
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // A verification outage shouldn't be a silent pass — fail closed.
    return false;
  }
}

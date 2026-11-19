// Signing in with a Hookka or Conts account (CONNECT-0003).
//
// Houzs ERP accounts are checked straight in the shared database (login/actions.ts).
// Hookka and Conts keep their accounts in their own systems, so Connect asks
// them, server to server: POST <ERP>/api/connect/verify-login with that ERP's key
// as a Bearer token. Connect never stores their passwords.
//
//   { email, password }  → { ok, user } or { twoStep, challenge }
//   { challenge, code }  → { ok, user }
//
// The challenge is the ERP's own proof that the password was right; Connect only
// carries it to the code step. readAnswer and erpOrder are pure, pinned by
// scripts/smoke-erp-logins.mjs.

import type { BrandKey } from "@/lib/company-brand";

export type OtherErp = "hookka" | "conts";

export const OTHER_ERPS: Record<OtherErp, { name: string; urlVar: "HOOKKA_LOGIN_URL" | "CONTS_LOGIN_URL"; keyVar: "HOOKKA_LOGIN_KEY" | "CONTS_LOGIN_KEY" }> = {
  hookka: { name: "Hookka ERP", urlVar: "HOOKKA_LOGIN_URL", keyVar: "HOOKKA_LOGIN_KEY" },
  conts: { name: "Conts ERP", urlVar: "CONTS_LOGIN_URL", keyVar: "CONTS_LOGIN_KEY" },
};

export type ErpAnswer =
  | { kind: "ok"; email: string; name: string }
  | { kind: "twoStep"; challenge: string }
  /** No such account, or a wrong password or code: try the next ERP. */
  | { kind: "wrong"; message: string }
  /** The account exists but may not sign in now (locked, disabled, too many tries): stop here. */
  | { kind: "stopped"; message: string }
  | { kind: "unreachable" };

const messageOf = (body: unknown): string => {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === "string") return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "";
};

/** One ERP's answer, from its status and JSON body. Both ERPs' error shapes are read. */
export function readAnswer(status: number, body: unknown): ErpAnswer {
  const b = (body ?? {}) as { ok?: unknown; twoStep?: unknown; challenge?: unknown; user?: { email?: unknown; name?: unknown } };
  if (status === 200 && b.twoStep === true && typeof b.challenge === "string" && b.challenge) {
    return { kind: "twoStep", challenge: b.challenge };
  }
  if (status === 200 && b.ok === true && typeof b.user?.email === "string" && b.user.email.includes("@")) {
    const email = b.user.email.trim().toLowerCase();
    return { kind: "ok", email, name: typeof b.user.name === "string" && b.user.name.trim() ? b.user.name.trim() : email };
  }
  // Connect's own key refused, or the ERP not set up for this: a fault on our side, not the person's.
  if (status === 401 && /not allowed/i.test(messageOf(body))) return { kind: "unreachable" };
  if (status === 401 || status === 400 || status === 422) return { kind: "wrong", message: messageOf(body) };
  if (status === 403 || status === 423 || status === 429) return { kind: "stopped", message: messageOf(body) || "This account cannot sign in right now." };
  return { kind: "unreachable" };
}

/** The ERPs to ask, the web address's own first. Only the ones Connect has a URL and key for. */
export function erpOrder(hostBrand: BrandKey, configured: OtherErp[]): OtherErp[] {
  const first = configured.filter((k) => k === hostBrand);
  return [...first, ...configured.filter((k) => k !== hostBrand)];
}

type Env = Partial<Record<"HOOKKA_LOGIN_URL" | "HOOKKA_LOGIN_KEY" | "CONTS_LOGIN_URL" | "CONTS_LOGIN_KEY", string>>;

export function configuredErps(env: Env): OtherErp[] {
  return (Object.keys(OTHER_ERPS) as OtherErp[]).filter((k) => env[OTHER_ERPS[k].urlVar]?.trim() && env[OTHER_ERPS[k].keyVar]?.trim());
}

/** Ask one ERP. Never throws: a network failure or timeout is "unreachable". */
export async function askErp(
  env: Env,
  erp: OtherErp,
  body: { email: string; password: string } | { challenge: string; code: string }
): Promise<ErpAnswer> {
  const base = (env[OTHER_ERPS[erp].urlVar] ?? "").trim().replace(/\/+$/, "");
  const key = (env[OTHER_ERPS[erp].keyVar] ?? "").trim();
  if (!base || !key) return { kind: "unreachable" };
  try {
    const res = await fetch(`${base}/api/connect/verify-login`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return readAnswer(res.status, await res.json().catch(() => null));
  } catch {
    return { kind: "unreachable" };
  }
}

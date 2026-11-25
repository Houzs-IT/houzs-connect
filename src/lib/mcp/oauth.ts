// OAuth 2.1 for the AI Connector: dynamic client registration, the authorize
// step (with the person's own Connect sign-in and an Allow / Cancel page), and
// the token endpoint (authorization_code + PKCE S256, rotating refresh tokens).
// The route files under src/app/api/mcp/oauth/* are thin wrappers over these.

import type { DB } from "@/db/client";
import type { CurrentMember } from "@/lib/current-member";
import { CORS_HEADERS, LEAK_CLIENT_ID, appLabel, esc, pkceS256, validCodeChallenge, validCodeVerifier, validRedirectUri } from "./core";
import {
  consumeCode,
  createAuthRequest,
  createCode,
  getAuthRequest,
  getClient,
  hasMcpAccess,
  issueTokens,
  mcpDb,
  refreshTokens,
  registerClient,
  takeAuthRequest,
} from "./store";
import { and, eq } from "drizzle-orm";
import { member } from "@/db/schema";
import { bypassReadCache } from "@/db/fresh";
import { isAccessRemoved } from "@/lib/team-access";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...CORS_HEADERS } });

// ── registration ──────────────────────────────────────────────────────────

export async function handleRegister(db: DB, req: Request): Promise<Response> {
  await mcpDb(db);
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5 || uris.some((u) => !validRedirectUri(u))) {
    return json({ error: "invalid_redirect_uri", error_description: "1-5 redirect URIs required: https, or http on localhost only" }, 400);
  }
  const cl = await registerClient(db, typeof body.client_name === "string" ? body.client_name : "AI app", uris);
  return json(
    {
      client_id: cl.clientId,
      client_name: cl.clientName,
      redirect_uris: cl.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201
  );
}

// ── authorize ─────────────────────────────────────────────────────────────

const plain = (msg: string, status = 400) =>
  new Response(`${msg}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export type AuthorizeStart = { kind: "error"; response: Response } | { kind: "pending"; requestId: string };

/** Validate an AI app's authorize redirect and park it as a 10-minute pending request. */
export async function startAuthorize(db: DB, url: URL): Promise<AuthorizeStart> {
  await mcpDb(db);
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const clientId = q("client_id");
  const redirectUri = q("redirect_uri");
  if (!clientId || !redirectUri) return { kind: "error", response: plain("Invalid request: missing client or redirect address.") };
  const cl = clientId === LEAK_CLIENT_ID ? null : await getClient(db, clientId);
  if (!cl) return { kind: "error", response: plain("This AI app is not registered. Remove the connector and add it again.") };
  // Never redirect to an address the client did not register (no open redirect).
  if (!cl.redirectUris.includes(redirectUri)) return { kind: "error", response: plain("Invalid request: the return address does not match this app.") };
  const back = (error: string, desc: string): AuthorizeStart => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", desc);
    if (q("state")) u.searchParams.set("state", q("state"));
    return { kind: "error", response: Response.redirect(u.toString(), 302) };
  };
  if (q("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (q("code_challenge_method") !== "S256" || !validCodeChallenge(q("code_challenge"))) return back("invalid_request", "PKCE with S256 is required");
  const requestId = await createAuthRequest(db, { clientId, redirectUri, state: q("state").slice(0, 500), codeChallenge: q("code_challenge") });
  return { kind: "pending", requestId };
}

const PAGE_CSS = `
:root{color-scheme:light dark;--bg:#f4f6f8;--card:#fff;--ink:#14202b;--muted:#5b6b78;--line:#dde3e8;--brand:#16695f;--brand-ink:#fff;--warn:#8a5a00;--warn-bg:#fff4dc}
@media (prefers-color-scheme:dark){:root{--bg:#0f1419;--card:#18212a;--ink:#e6edf3;--muted:#9aa8b4;--line:#2a3742;--brand:#2fa595;--warn:#ffcf70;--warn-bg:#3a2e12}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
h1{font-size:19px;margin:0 0 4px}p{margin:8px 0;color:var(--muted)}ul{margin:10px 0 14px;padding-left:18px}li{margin:4px 0}
.who{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:14px 0}.who b{display:block;color:var(--ink)}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:10px;padding:10px 12px;margin:12px 0}
.row{display:flex;gap:10px;margin-top:16px}button,a.btn{flex:1;height:44px;border-radius:10px;font:600 15px system-ui,sans-serif;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink);text-decoration:none;display:grid;place-items:center}
button.allow{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}small{color:var(--muted)}`;

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main class="card">${body}</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function expiredPage(): Response {
  return page("Connect an AI app", `<h1>This connect request has expired</h1><p>Go back to Claude or ChatGPT and add the connector again.</p>`);
}

/** The "Allow?" page for the signed-in person. */
export async function consentPage(db: DB, requestId: string, me: CurrentMember, companyName: string): Promise<Response> {
  const req = await getAuthRequest(db, requestId);
  if (!req) return expiredPage();
  const cl = await getClient(db, req.clientId);
  const app = appLabel(cl?.clientName);
  let host = "";
  try {
    host = new URL(req.redirectUri).host;
  } catch {
    host = "";
  }
  const allowed = await hasMcpAccess(db, me.email, me.role);
  const who = `<div class="who"><small>Signed in to Houzs Connect as</small><b>${esc(me.name)}</b><small>${esc(me.email)} · ${esc(companyName)}</small></div>`;
  const form = (inner: string) =>
    `<form method="post" action="/api/mcp/oauth/authorize"><input type="hidden" name="request" value="${esc(req.id)}">${inner}</form>`;
  if (!allowed) {
    return page(
      "Connect an AI app",
      `<h1>Connect ${esc(app)} to Houzs Connect</h1>${who}<div class="warn">AI Connector is not turned on for your account yet. Ask for access on <b>Settings → AI Connector</b>; once the admin approves, add the connector again.</div>` +
        form(`<div class="row"><a class="btn" href="/settings/ai-connector">Request access</a><button name="decision" value="cancel">Cancel</button></div>`)
    );
  }
  return page(
    "Connect an AI app",
    `<h1>Allow ${esc(app)} to read Houzs Connect?</h1>${who}
<p>${esc(cl?.clientName ?? "This app")} will be able to:</p>
<ul><li><b>Read only</b> — it can never send, change or delete anything.</li><li>See only what <b>your own login</b> can see.</li><li>Every lookup is recorded; the admin can disconnect it at any time.</li></ul>
<p><small>After you allow, you go back to ${esc(host || "the app")}.</small></p>` +
      form(`<div class="row"><button name="decision" value="cancel">Cancel</button><button class="allow" name="decision" value="allow">Allow</button></div>`)
  );
}

/** The Allow / Cancel button. Single use; the code is bound to the signed-in member. */
export async function decideConsent(db: DB, requestId: string, allow: boolean, me: CurrentMember): Promise<Response> {
  await mcpDb(db);
  if (allow && !(await hasMcpAccess(db, me.email, me.role))) {
    return page("Connect an AI app", `<h1>Not turned on yet</h1><p>AI Connector is not turned on for your account. Ask for access on Settings → AI Connector.</p>`);
  }
  const req = await takeAuthRequest(db, requestId);
  if (!req) return expiredPage();
  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set("state", req.state);
  if (!allow) {
    back.searchParams.set("error", "access_denied");
  } else {
    back.searchParams.set("code", await createCode(db, { clientId: req.clientId, memberId: me.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge }));
  }
  return new Response(null, { status: 303, headers: { Location: back.toString(), "Cache-Control": "no-store" } });
}

// ── token ─────────────────────────────────────────────────────────────────

export async function handleToken(db: DB, req: Request): Promise<Response> {
  await mcpDb(db);
  const ct = req.headers.get("content-type") ?? "";
  const f: Record<string, string> = {};
  try {
    if (ct.includes("application/json")) {
      for (const [k, v] of Object.entries((await req.json()) as Record<string, unknown>)) if (typeof v === "string") f[k] = v;
    } else {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) if (typeof v === "string") f[k] = v;
    }
  } catch {
    /* empty body → errors below */
  }
  const err = (error: string, desc: string, status = 400) => json({ error, error_description: desc }, status);
  const clientId = f.client_id || "";
  if (!clientId || clientId === LEAK_CLIENT_ID || !(await getClient(db, clientId))) return err("invalid_client", "Unknown client", 401);

  let memberId: string;
  let issued: { accessToken: string; refreshToken: string; expiresIn: number; tokenId: string };
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return err("invalid_request", "code and code_verifier are required");
    if (!validCodeVerifier(f.code_verifier)) return err("invalid_grant", "code_verifier is malformed");
    const rec = await consumeCode(db, f.code);
    if (!rec || rec.clientId !== clientId) return err("invalid_grant", "Code is invalid, used or expired");
    if (f.redirect_uri && f.redirect_uri !== rec.redirectUri) return err("invalid_grant", "redirect_uri mismatch");
    if ((await pkceS256(f.code_verifier)) !== rec.codeChallenge) return err("invalid_grant", "PKCE check failed");
    memberId = rec.memberId;
    const m = await liveMember(db, memberId);
    if (!m) return err("invalid_grant", "This account may not use the AI connector");
    issued = await issueTokens(db, m, clientId);
  } else if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return err("invalid_request", "refresh_token is required");
    const r = await refreshTokens(db, f.refresh_token, clientId);
    if (!r) return err("invalid_grant", "Refresh token is invalid, revoked or expired");
    memberId = r.memberId;
    issued = r;
  } else {
    return err("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
  if (!(await liveMember(db, memberId))) return err("invalid_grant", "This account may not use the AI connector");
  return json({ access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, refresh_token: issued.refreshToken, scope: "connect.read" });
}

/** The member a code / refresh token belongs to, if they may still connect. */
async function liveMember(db: DB, memberId: string): Promise<{ id: string; email: string } | null> {
  const m = await db.query.member.findFirst({ where: and(eq(member.id, memberId), bypassReadCache()), columns: { id: true, email: true, role: true, active: true } });
  if (!m || !m.active) return null;
  if (await isAccessRemoved(db, m.email)) return null;
  if (!(await hasMcpAccess(db, m.email, m.role))) return null;
  return { id: m.id, email: m.email };
}

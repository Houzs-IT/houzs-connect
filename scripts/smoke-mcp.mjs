// Pure smoke for the AI Connector (src/lib/mcp/*): PKCE, redirect-URI rule,
// path gating, secret stripping, reply cap, discovery, the endpoint catalogue,
// the runtime DDL matching migration 0027, and — the read-only guarantee — that
// nothing the MCP handler can reach imports a "use server" module.
// No DB, no network.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const core = await import("../src/lib/mcp/core.ts");

// ── PKCE: RFC 7636 Appendix B vector ──
assert(
  (await core.pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")) === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  "PKCE S256 matches the RFC 7636 test vector"
);
assert(core.validCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "RFC verifier is well-formed");
assert(!core.validCodeVerifier("short"), "a 5-char verifier is refused");
assert(!core.validCodeVerifier("a".repeat(129)), "a 129-char verifier is refused");
assert(core.validCodeChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), "RFC challenge is well-formed");
assert(!core.validCodeChallenge("plain-text"), "a plain challenge is refused");

// ── Redirect URI rule: https anywhere, http only on loopback ──
assert(core.validRedirectUri("https://claude.ai/api/mcp/auth_callback"), "https is allowed");
assert(core.validRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), "ChatGPT callback is allowed");
assert(core.validRedirectUri("http://localhost:6274/oauth/callback"), "http localhost is allowed");
assert(core.validRedirectUri("http://127.0.0.1:33418/cb"), "http 127.0.0.1 is allowed");
assert(core.validRedirectUri("http://[::1]:8080/cb"), "http [::1] is allowed");
assert(!core.validRedirectUri("http://evil.example/cb"), "plain http elsewhere is refused");
assert(!core.validRedirectUri("http://localhost.evil.example/cb"), "a localhost lookalike is refused");
assert(!core.validRedirectUri("https://claude.ai/cb#frag"), "a fragment is refused");
assert(!core.validRedirectUri("https://user:pw@claude.ai/cb"), "credentials in the URI are refused");
assert(!core.validRedirectUri("javascript:alert(1)"), "javascript: is refused");
assert(!core.validRedirectUri("not a url"), "garbage is refused");
assert(!core.validRedirectUri("https://x.example/" + "a".repeat(600)), "an over-long URI is refused");

// ── Path gating ──
const ok = (p) => core.classifyPath(p).ok;
assert(ok("/conversations") && ok("/contacts/abc123") && ok("/dashboard/summary"), "catalogue paths pass");
assert(core.classifyPath("/contacts/").path === "/contacts", "a trailing slash is dropped");
assert(core.classifyPath("/contacts?q=x").path === "/contacts", "the query string is dropped");
for (const p of [
  "/internal",
  "/internal/abc",
  "/settings/developers",
  "/settings",
  "/Settings/developers",
  "/login",
  "/api/v1/contacts",
  "/api/mcp",
  "/mcp",
  "/it-support/tickets",
  "/webhooks/erp",
  "/session/handoff",
]) {
  assert(!ok(p), `blocked: ${p}`);
}
for (const p of ["contacts", "/contacts/../settings", "//contacts", "/contacts/%2e%2e", "/contacts\\x", "/a b", 42, null, "/" + "a".repeat(250)]) {
  assert(!ok(p), `invalid: ${JSON.stringify(p)}`);
}
assert(JSON.stringify(core.matchPattern("/conversations/:id", "/conversations/abc_1-2")) === '{"id":"abc_1-2"}', "pattern captures an id");
assert(core.matchPattern("/conversations/:id", "/conversations") === null, "wrong length does not match");
assert(core.matchPattern("/conversations/:id", "/conversations/a.b") === null, "an id with a dot is refused");

// ── Secret stripping ──
const { value, removed } = core.redactSecrets({
  name: "Wong",
  password: "x",
  nested: { api_key: "k", apiKey: "k", access_token: "t", totp_secret: "s", ok: 1, list: [{ password_hash: "h", body: "hi" }] },
  session_pass: "p",
  amount: 12,
  at: new Date("2026-11-25T00:00:00Z"),
});
const flat = JSON.stringify(value);
for (const k of ["password", "api_key", "apiKey", "access_token", "totp_secret", "password_hash", "session_pass"]) {
  assert(!flat.includes(`"${k}"`), `stripped ${k}`);
  assert(removed.has(k), `reported ${k}`);
}
assert(flat.includes('"name":"Wong"') && flat.includes('"amount":12') && flat.includes('"body":"hi"'), "ordinary fields kept");
assert(flat.includes("2026-11-25T00:00:00.000Z"), "dates serialised");

// ── Reply cap ──
const big = core.capText("x".repeat(70_000));
assert(big.cut && big.text.length < 60_000 + 300 && big.text.includes("Reply cut at 60000"), "replies are capped at 60k with a note");
assert(!core.capText("{}").cut, "a small reply is not cut");

// ── Origin + discovery ──
assert(core.originFor("chat.houzscentury.com", "http://chat.houzscentury.com/x") === "https://chat.houzscentury.com", "public host is https");
assert(core.originFor("localhost:3000", "http://localhost:3000/x") === "http://localhost:3000", "dev server keeps http");
const pr = core.protectedResourceMetadata("https://chat.hookka.com");
assert(pr.resource === "https://chat.hookka.com/api/mcp" && pr.authorization_servers[0] === "https://chat.hookka.com", "protected-resource metadata");
const as = core.authorizationServerMetadata("https://c.example");
assert(as.code_challenge_methods_supported.join() === "S256" && as.token_endpoint_auth_methods_supported.join() === "none", "auth-server metadata: S256, public clients");
assert(as.registration_endpoint === "https://c.example/api/mcp/oauth/register", "registration endpoint");
assert(core.MCP_PROTOCOL_VERSIONS.join() === "2025-06-18,2025-03-26,2024-11-05", "protocol versions");
assert(core.isMcpAdminRole("SUPER_ADMIN") && core.isMcpAdminRole("OWNER") && !core.isMcpAdminRole("ADMIN") && !core.isMcpAdminRole("AGENT"), "admin roles");
assert(core.esc(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;", "HTML escaping");
assert(core.appLabel("Claude") === "Claude" && core.appLabel("ChatGPT connector") === "ChatGPT" && core.appLabel("") === "AI app", "app labels");

// ── Catalogue ──
const reads = await import("../src/lib/mcp/reads.ts");
const { MODULES } = await import("../src/lib/module-access.ts");
for (const ep of reads.ENDPOINTS) {
  assert(core.classifyPath(ep.path.replace(/:id/g, "x1")).ok, `endpoint ${ep.path} is not blocked`);
  assert(MODULES.includes(ep.module), `endpoint ${ep.path} belongs to a real module`);
  assert(reads.findEndpoint(ep.path.replace(/:id/g, "x1"))?.ep === ep, `endpoint ${ep.path} is found by its own path`);
}
assert(reads.findEndpoint("/nope") === null, "unknown path finds nothing");
assert(!reads.ENDPOINTS.some((e) => e.module === "internal" || e.module === "settings"), "no internal-chat or settings endpoint");
assert(reads.listEndpointPaths().every((p) => !p.includes(":")), "leak check reads only parameter-free lists");
assert(reads.moduleCatalog(["inbox"]).every((m) => m.module === "inbox"), "module catalogue follows the person's modules");

// ── Runtime DDL == migration 0027 ──
const { MCP_DDL } = await import("../src/db/ensure-mcp.ts");
const mig = readFileSync(resolve(root, "src/db/migrations/0027_mcp_connector.sql"), "utf8");
for (const t of ["mcp_access", "mcp_access_requests", "mcp_oauth_clients", "mcp_auth_requests", "mcp_oauth_codes", "mcp_tokens", "mcp_calls"]) {
  assert(MCP_DDL.some((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS "connect"."${t}"`)), `ensure creates ${t}`);
}
for (const s of MCP_DDL) assert(mig.includes(s), `migration carries: ${s.slice(0, 60)}`);
const journal = JSON.parse(readFileSync(resolve(root, "src/db/migrations/meta/_journal.json"), "utf8"));
assert(journal.entries.some((e) => e.tag === "0027_mcp_connector"), "0027 is in the journal");

// ── Read-only by construction: nothing reachable from the MCP handlers imports a "use server" module ──
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = resolve(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, base + ".ts", base + ".tsx", resolve(base, "index.ts")]) if (existsSync(c) && !c.endsWith("\\") && /\.(ts|tsx)$/.test(c)) return c;
  return null;
}
const seen = new Set();
const offenders = [];
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  if (/^\s*["']use server["']/.test(src)) offenders.push(file.slice(root.length + 1));
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) {
    const f = resolveImport(file, m[1]);
    if (f) walk(f);
  }
}
for (const entry of [
  "src/app/api/mcp/route.ts",
  "src/app/api/mcp/oauth/register/route.ts",
  "src/app/api/mcp/oauth/token/route.ts",
  "src/app/api/mcp/oauth/authorize/route.ts",
  "src/lib/mcp/admin.ts",
]) {
  walk(resolve(root, entry));
}
assert(seen.size > 10, `the import walk found the MCP modules (${seen.size} files)`);
assert(offenders.length === 0, `no "use server" module is reachable from the connector: ${offenders.join(", ")}`);
// The app's own auth never accepts a connector token.
for (const f of ["src/lib/current-member.ts", "src/lib/api-keys.ts"]) {
  const src = readFileSync(resolve(root, f), "utf8");
  assert(!/hcmcp/i.test(src) && !/mcp_tokens/.test(src), `${f} knows nothing of connector tokens`);
}
assert(!"hcmcp_x".startsWith("hc_"), "a connector token cannot pass the API-key prefix check");

console.log(`smoke-mcp: ok (${n} assertions, ${seen.size} files walked)`);

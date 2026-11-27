"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { isMcpAdminRole, originFor } from "@/lib/mcp/core";
import { parseSubscriptionInput } from "@/lib/mcp/proactive";
import { saveSubscription } from "@/lib/mcp/proactive-store";
import { previewBrief, sendTestBrief, type Person } from "@/lib/mcp/proactive-run";
import { companyName } from "@/lib/mcp/reads";
import { runLeakCheck, type LeakReport } from "@/lib/mcp/admin";
import { isWriteKind, MAIN_SWITCH, setSwitch, WRITE_LABELS } from "@/lib/mcp/actions";
import { decideRequest, grantAccess, hasMcpAccess, mcpDb, removeAccess, requestAccess, revokeEmailTokens, revokeToken } from "@/lib/mcp/store";

// Settings → AI Connector. Every export here is a POST endpoint reachable by
// anyone who finds its id, so each one checks the signed-in member itself; the
// admin ones also check the role (Super Admin / Owner, lib/mcp/core.ts).

type Result = { ok: boolean; error?: string; message?: string };
const PATH = "/settings/ai-connector";

async function signedIn() {
  const me = await getCurrentMember();
  if (!me) return null;
  return { me, db: await mcpDb(getDb()) };
}

async function admin() {
  const s = await signedIn();
  return s && isMcpAdminRole(s.me.role) ? s : null;
}

export async function requestMcpAccess(reason: string): Promise<Result> {
  const s = await signedIn();
  if (!s) return { ok: false, error: "Sign in again." };
  const r = await requestAccess(s.db, s.me, String(reason ?? "").trim());
  revalidatePath(PATH);
  return { ok: true, message: r === "already" ? "You already asked — waiting for the admin." : "Request sent to the admin." };
}

export async function disconnectMyApp(tokenId: string): Promise<Result> {
  const s = await signedIn();
  if (!s) return { ok: false, error: "Sign in again." };
  const n = await revokeToken(s.db, String(tokenId), s.me.email);
  revalidatePath(PATH);
  return n ? { ok: true, message: "Disconnected." } : { ok: false, error: "Already disconnected." };
}

export async function decideMcpRequest(id: string, approve: boolean): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const email = await decideRequest(s.db, String(id), !!approve, s.me.id);
  if (!email) return { ok: false, error: "Request not found or already decided." };
  revalidatePath(PATH);
  return { ok: true, message: approve ? `Turned on for ${email}.` : "Rejected." };
}

export async function turnOnMcp(email: string): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const e = String(email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return { ok: false, error: "Pick a person." };
  await grantAccess(s.db, e, s.me.id);
  revalidatePath(PATH);
  return { ok: true, message: `Turned on for ${e}.` };
}

export async function removeMcpAccess(email: string): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const e = String(email ?? "").trim().toLowerCase();
  const cut = await removeAccess(s.db, e);
  revalidatePath(PATH);
  return { ok: true, message: `Removed. ${cut} connection(s) cut.` };
}

export async function disconnectConnection(tokenId: string): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const n = await revokeToken(s.db, String(tokenId), null);
  revalidatePath(PATH);
  return n ? { ok: true, message: "Disconnected." } : { ok: false, error: "Already disconnected." };
}

export async function disconnectPerson(email: string): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const n = await revokeEmailTokens(s.db, String(email ?? ""));
  revalidatePath(PATH);
  return { ok: true, message: `${n} connection(s) cut.` };
}

/** Round 4b: the main "Allow AI actions" switch ("actions") or one action's switch. Connector admins only. */
export async function setMcpActionSwitch(key: string, enabled: boolean): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const k = String(key ?? "");
  if (!(await setSwitch(s.db, k, !!enabled, s.me.id))) return { ok: false, error: "Unknown switch." };
  revalidatePath(PATH);
  const label = k === MAIN_SWITCH ? "AI actions" : isWriteKind(k) ? WRITE_LABELS[k].title : k;
  return { ok: true, message: `${label}: ${enabled ? "on" : "off"}.` };
}

export async function leakCheck(email: string): Promise<{ ok: boolean; error?: string; report?: LeakReport }> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const r = await runLeakCheck(s.db, String(email ?? ""), s.me.companyId);
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, report: r };
}

// ── Round 4d: my morning brief + urgent alerts (each person, their own only) ──

async function briefPerson() {
  const s = await signedIn();
  if (!s) return null;
  const allowed = await hasMcpAccess(s.db, s.me.email, s.me.role);
  const company = await companyName(s.db, s.me.companyId).catch(() => "");
  const person: Person = { memberId: s.me.id, email: s.me.email, name: s.me.name, company: company ?? "" };
  return { ...s, allowed, person };
}

const NOT_ALLOWED = "AI Connector is not turned on for your account. Ask for access first.";

export async function saveMyBriefSettings(input: { briefEnabled: boolean; briefTime: string; briefDays: string; alertsEnabled: boolean }): Promise<Result> {
  const s = await briefPerson();
  if (!s) return { ok: false, error: "Sign in again." };
  if (!s.allowed) return { ok: false, error: NOT_ALLOWED };
  const parsed = parseSubscriptionInput(input, s.me.id);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if ((parsed.value.briefEnabled || parsed.value.alertsEnabled) && !s.me.email.includes("@")) return { ok: false, error: "Your Connect account has no email address." };
  await saveSubscription(s.db, parsed.value, s.me.email);
  revalidatePath(PATH);
  const on = [parsed.value.briefEnabled ? `morning brief at ${parsed.value.briefTime} (${parsed.value.briefDays})` : "", parsed.value.alertsEnabled ? "urgent alerts" : ""].filter(Boolean);
  return { ok: true, message: on.length ? `Saved: ${on.join(" and ")} to ${s.me.email}.` : "Saved: no emails." };
}

/** The brief as it would be sent now, built as you — nothing is sent. */
export async function previewMyBrief(withGaps: boolean): Promise<{ ok: boolean; error?: string; subject?: string; html?: string; items?: number }> {
  const s = await briefPerson();
  if (!s) return { ok: false, error: "Sign in again." };
  if (!s.allowed) return { ok: false, error: NOT_ALLOWED };
  const h = await headers();
  const host = h.get("host");
  const origin = originFor(host, `${h.get("x-forwarded-proto") ?? "https"}://${host ?? "localhost"}`);
  const b = await previewBrief(s.db, s.person, origin, !!withGaps);
  if (!b.ok) return { ok: false, error: `The brief could not be built: ${b.message}` };
  return { ok: true, subject: b.subject, html: b.html, items: b.items };
}

/** "Send me a test brief now" — to your own email only, at most once per 10 minutes. */
export async function sendMyTestBrief(): Promise<Result> {
  const s = await briefPerson();
  if (!s) return { ok: false, error: "Sign in again." };
  if (!s.allowed) return { ok: false, error: NOT_ALLOWED };
  const h = await headers();
  const host = h.get("host");
  const origin = originFor(host, `${h.get("x-forwarded-proto") ?? "https"}://${host ?? "localhost"}`);
  const r = await sendTestBrief(s.db, getCloudflareContext().env, s.person, origin);
  revalidatePath(PATH);
  return r.ok ? { ok: true, message: `Test brief sent to ${r.sentTo} (${r.items} item${r.items === 1 ? "" : "s"}).` } : { ok: false, error: r.error };
}

"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { isMcpAdminRole } from "@/lib/mcp/core";
import { runLeakCheck, type LeakReport } from "@/lib/mcp/admin";
import { decideRequest, grantAccess, mcpDb, removeAccess, requestAccess, revokeEmailTokens, revokeToken } from "@/lib/mcp/store";

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

export async function leakCheck(email: string): Promise<{ ok: boolean; error?: string; report?: LeakReport }> {
  const s = await admin();
  if (!s) return { ok: false, error: "Only the AI Connector admin can do that." };
  const r = await runLeakCheck(s.db, String(email ?? ""), s.me.companyId);
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, report: r };
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { companyChoices, isSuperAdmin } from "@/lib/companies";
import { createConnectCompany } from "@/lib/whatsapp/number-assignment";
import { SESSION_COOKIE, signHandoff, signSession } from "@/lib/erp-auth";
import { brandForCompany, companyOrigin } from "@/lib/company-brand";

/** Re-sign this browser's session as one member row — the single place the
 *  session cookie is written, so switching and creating a company sign in the
 *  same way. */
async function setSessionCookie(memberId: string, secret: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(memberId, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
}

/**
 * Work in another company: re-sign the session as this person's member row there.
 *
 * Every page and action in the app scopes by the session member's companyId, so
 * switching the member IS switching the company — nothing else has to know.
 * Eligibility comes from companyChoices(); a hand-posted id that is not on that
 * list does nothing.
 */
/** Sections a switch may land on: the page you were on, minus any record id
 *  (a conversation or campaign of one company does not exist in another). */
const SECTIONS = new Set([
  "inbox", "internal", "dashboard", "contacts", "automations", "campaigns",
  "templates", "forms", "payments", "logs", "settings",
]);

export async function switchCompany(formData: FormData): Promise<{ go: string } | void> {
  const targetId = String(formData.get("companyId") ?? "");
  const section = String(formData.get("next") ?? "");
  const next = SECTIONS.has(section) ? `/${section}` : "/inbox";
  const me = await getCurrentMember();
  if (!me) redirect("/login");

  const db = getDb();
  const choice = (await companyChoices(db, me)).find((c) => c.id === targetId);
  if (!choice || choice.current) redirect(next);

  const secret = getCloudflareContext().env.SESSION_SECRET;
  if (!secret) redirect("/inbox");

  // A Connect-only company has no ERP sync to create the row, so a Super Admin
  // gets one on first entry, carrying the role they already hold. For an
  // ERP company the row already exists (that is why it was a choice) and is left
  // exactly as the sync wrote it.
  const [row] = await db
    .insert(member)
    .values({
      companyId: choice.id,
      email: me.email,
      name: me.name,
      role: me.role,
      title: me.title,
    })
    .onConflictDoUpdate({
      target: [member.companyId, member.email],
      set: choice.connectOnly ? { active: true } : { email: me.email },
    })
    .returning({ id: member.id, active: member.active });

  if (!row?.active) redirect("/inbox");

  // Each company has its own address (CONNECT-0003): move there, carrying the
  // session over, and leave this address signed in where it was.
  const env = getCloudflareContext().env;
  const origin = companyOrigin(brandForCompany(choice.name).key, (await headers()).get("host"), env.COMPANY_DOMAINS_LIVE === "1");
  // Returned, not redirected: a server action's redirect to another address is
  // followed in the background and the page never moves (seen locally), so the
  // switcher sends the browser there itself (TopbarControls goToCompany).
  if (origin) {
    const t = await signHandoff(row.id, secret);
    return { go: `${origin}/api/session/handoff?t=${encodeURIComponent(t)}&next=${encodeURIComponent(next)}` };
  }

  await setSessionCookie(row.id, secret);
  redirect(next);
}

/**
 * Create a new Connect-only company and drop the owner straight into it.
 *
 * This is the "number later" path: a company can exist, take contacts and be
 * worked in before any WhatsApp number is assigned (Settings → Numbers attaches
 * one to the already-existing company afterwards). Creation is Super Admin only,
 * the same bar companyChoices() uses to let them into a Connect-only company —
 * re-checked here because this is a public endpoint, not guarded by the UI.
 *
 * Returns an error for the dialog to show (a clashing name, a bad length); on
 * success it signs the session into the new company and the client navigates.
 */
export async function createCompany(rawName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "Please sign in again." };
  if (!isSuperAdmin(me.role)) {
    return { ok: false, error: "Only a Super Admin can create a company." };
  }
  const secret = getCloudflareContext().env.SESSION_SECRET;
  if (!secret) return { ok: false, error: "The session is misconfigured — try again." };

  const db = getDb();
  const made = await createConnectCompany(db, rawName);
  if ("error" in made) return { ok: false, error: made.error };

  // The creator's own member row in the new company, carrying their role, then
  // sign in there. onConflict covers the impossible-but-cheap re-entry.
  const [row] = await db
    .insert(member)
    .values({
      companyId: made.id,
      email: me.email,
      name: me.name,
      role: me.role,
      title: me.title,
    })
    .onConflictDoUpdate({ target: [member.companyId, member.email], set: { active: true } })
    .returning({ id: member.id });
  if (!row) return { ok: false, error: "Could not open the new company." };

  await setSessionCookie(row.id, secret);
  return { ok: true };
}

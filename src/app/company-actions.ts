"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { companyChoices } from "@/lib/companies";
import { SESSION_COOKIE, signSession } from "@/lib/erp-auth";

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

export async function switchCompany(formData: FormData) {
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

  // A Connect-only company has no ERP sync to create the row, so an owner or
  // admin gets one on first entry, carrying the role they already hold. For an
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

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(row.id, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  redirect(next);
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAccessRemoved, roleOverride } from "@/lib/team-access";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { company, member } from "@/db/schema";
import { brandForCompany, brandForHost, companyOrigin, pickLoginRow } from "@/lib/company-brand";
import { askErp, configuredErps, erpOrder, OTHER_ERPS, type OtherErp } from "@/lib/erp-logins";
import {
  verifyErpPassword,
  roleFromErp,
  signHandoff,
  signSession,
  SESSION_COOKIE,
} from "@/lib/erp-auth";

type LoginState = {
  error?: string;
  /** The ERP wants its two-step code: the next submit carries the code and this challenge. */
  twoStep?: { system: OtherErp; systemName: string; challenge: string };
  /** Signed in, on another company's address: the browser goes here (LoginView). */
  go?: string;
};

/** Who the password belongs to. houzs carries the Houzs ERP role, which its synced rows follow. */
type Verified = { email: string; name: string; houzs: { roleName: string | null } | null };

/**
 * Log in with a Houzs ERP, Hookka ERP or Conts ERP account (CONNECT-0003).
 * Houzs accounts are checked in the shared database; Hookka and Conts are asked
 * (lib/erp-logins.ts), the web address's own ERP first, with their two-step code
 * when the account has one. Then sign in as one of the person's active member
 * rows: the web address's company when they hold it, otherwise their first.
 * Holding no company means no way in.
 */
export async function login(
  prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const { env } = getCloudflareContext();
  const secret = env.SESSION_SECRET;
  if (!secret) return { error: "Login is not configured yet (missing SESSION_SECRET)." };

  const db = getDb();
  const host = (await headers()).get("host");
  let who: Verified | null = null;

  const challenge = String(formData.get("challenge") ?? "");
  const system = String(formData.get("system") ?? "") as OtherErp;
  if (challenge) {
    // The code step. The challenge is the ERP's own proof of the password.
    if (!(system in OTHER_ERPS)) return { error: "Enter your email and password again." };
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { error: "Enter the code from your authenticator app.", twoStep: prev.twoStep };
    const a = await askErp(env, system, { challenge, code });
    if (a.kind === "ok") who = { email: a.email, name: a.name, houzs: null };
    else if (a.kind === "wrong") return { error: a.message || "That code is not right.", twoStep: prev.twoStep };
    else if (a.kind === "stopped") return { error: a.message };
    else return { error: `Cannot reach ${OTHER_ERPS[system].name} right now. Try again in a moment.`, twoStep: prev.twoStep };
  } else {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!email || !password) return { error: "Enter your email and password." };

    let erp:
      | { id: number; email: string; name: string | null; password_hash: string; status: string; role_name: string | null }
      | undefined;
    try {
      const rows = (await db.execute(sql`
        SELECT u.id, u.email, u.name, u.password_hash, u.status, r.name AS role_name
        FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE lower(u.email) = ${email}
        LIMIT 1
      `)) as unknown as Array<typeof erp>;
      erp = rows[0];
    } catch {
      // Most likely the `houzs_connect` role lacks SELECT on public.users yet.
      return { error: "Cannot reach the staff directory. Ask IT to grant access." };
    }
    if (erp && erp.status === "active" && (await verifyErpPassword(password, erp.password_hash))) {
      who = { email, name: erp.name ?? email, houzs: { roleName: erp.role_name } };
    }

    // Not a Houzs account (or not this password): ask Hookka and Conts. The same
    // email may be in more than one with different passwords, so a wrong password
    // moves on to the next; a locked or disabled account stops here.
    let unreachable: OtherErp | null = null;
    for (const k of who ? [] : erpOrder(brandForHost(host).key, configuredErps(env))) {
      const a = await askErp(env, k, { email, password });
      if (a.kind === "ok") {
        who = { email: a.email, name: a.name, houzs: null };
        break;
      }
      if (a.kind === "twoStep") return { twoStep: { system: k, systemName: OTHER_ERPS[k].name, challenge: a.challenge } };
      if (a.kind === "stopped") return { error: a.message };
      if (a.kind === "unreachable") unreachable ??= k;
    }
    if (!who) {
      return {
        error: unreachable
          ? `Wrong email or password, or ${OTHER_ERPS[unreachable].name} could not be reached. Try again in a moment.`
          : "Wrong email or password.",
      };
    }
  }
  const { email } = who;

  // Signing in never grants a company: member rows come from the ERP sync
  // (src/lib/sync/erp-org.ts) or a Super Admin on the Team page. member.email is
  // not globally unique (the same person recurs once per company).
  // Connect's own decisions (lib/team-access.ts): access removed here, or a
  // role an admin picked here instead of the one the ERP maps to.
  if (await isAccessRemoved(db, email)) {
    return { error: "Your access to Houzs Connect was removed. Ask an admin to restore it." };
  }
  const rows = await db
    .select({ id: member.id, erpUserId: member.erpUserId, companyName: company.name })
    .from(member)
    .innerJoin(company, eq(company.id, member.companyId))
    // Fresh (db/fresh.ts): access given or taken a moment ago must count now.
    .where(and(sql`lower(${member.email}) = ${email}`, eq(member.active, true), eq(company.active, true), bypassReadCache()))
    .orderBy(asc(company.createdAt));
  const m = pickLoginRow(rows, host);
  if (!m) return { error: "Your account has no company access in Connect yet. Ask a Super Admin." };

  // A row synced from the Houzs ERP follows it. A manual grant keeps the role set on it.
  if (who.houzs && m.erpUserId != null) {
    const override = await roleOverride(db, email);
    const role = (override ?? roleFromErp(who.houzs.roleName)) as ReturnType<typeof roleFromErp>;
    await db
      .update(member)
      .set({
        name: who.name,
        // SUPER_ADMIN is granted in Connect, not the ERP — signing in keeps it.
        role: sql`case when ${member.role}::text = 'SUPER_ADMIN' then ${member.role} else ${role}::"connect"."Role" end`,
        title: who.houzs.roleName ?? null,
      })
      .where(eq(member.id, m.id));
  }

  // Landed in a company with its own address (say, signed in on Houzs's with only
  // Hookka): move there, carrying the session over.
  const origin = companyOrigin(brandForCompany(m.companyName).key, host, env.COMPANY_DOMAINS_LIVE === "1");
  // Returned rather than redirected: an action's redirect to another address is
  // followed in the background and the page never moves.
  if (origin) return { go: `${origin}/api/session/handoff?t=${encodeURIComponent(await signHandoff(m.id, secret))}&next=%2Finbox` };

  const token = await signSession(m.id, secret);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  redirect("/inbox");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isAccessRemoved, roleOverride } from "@/lib/team-access";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import {
  verifyErpPassword,
  roleFromErp,
  signSession,
  SESSION_COOKIE,
} from "@/lib/erp-auth";

type LoginState = { error?: string };

/**
 * Log in with a real Houzs ERP account. Verifies email + password against the
 * ERP's `public.users` (shared Supabase DB), mirrors the user into a Connect
 * member (by email), and sets a signed session cookie.
 */
export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const { env } = getCloudflareContext();
  const secret = env.SESSION_SECRET;
  if (!secret) return { error: "Login is not configured yet (missing SESSION_SECRET)." };

  const db = getDb();

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

  if (
    !erp ||
    erp.status !== "active" ||
    !(await verifyErpPassword(password, erp.password_hash))
  ) {
    return { error: "Wrong email or password." };
  }

  const co = await db.query.company.findFirst({ orderBy: (c, { asc }) => asc(c.createdAt) });
  if (!co) return { error: "No company configured." };

  // Mirror the logging-in user into a Connect member for THIS company. The org
  // as a whole is mirrored one-way from the ERP by the dedicated API sync
  // (src/lib/sync/erp-org.ts); Connect does not build an org chart here. Conflict
  // target is (company_id, email) — member.email is no longer globally unique
  // (the same person recurs once per company via the sync's fan-out).
  // Connect's own decisions (lib/team-access.ts): access removed here, or a
  // role an admin picked here instead of the one the ERP maps to.
  if (await isAccessRemoved(db, email)) {
    return { error: "Your access to Houzs Connect was removed. Ask an admin to restore it." };
  }
  const override = await roleOverride(db, email);
  const role = (override ?? roleFromErp(erp.role_name)) as ReturnType<typeof roleFromErp>;
  const [m] = await db
    .insert(member)
    .values({ companyId: co.id, email, name: erp.name ?? email, role, title: erp.role_name ?? null })
    .onConflictDoUpdate({
      target: [member.companyId, member.email],
      // SUPER_ADMIN is granted in Connect, not the ERP — signing in keeps it.
      set: {
        name: erp.name ?? email,
        role: sql`case when ${member.role}::text = 'SUPER_ADMIN' then ${member.role} else ${role}::"connect"."Role" end`,
        title: erp.role_name ?? null,
      },
    })
    .returning();

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

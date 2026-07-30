"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import {
  verifyErpPassword,
  roleFromErp,
  signSession,
  SESSION_COOKIE,
} from "@/lib/erp-auth";
import { syncOrgChart } from "@/lib/erp-sync";

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

  // Mirror the whole ERP org chart (departments + reporting line) so RBAC works
  // for everyone, not just whoever logged in. Best-effort — a missing grant on
  // public.departments must never block the login itself.
  await syncOrgChart(co.id).catch(() => {});

  const role = roleFromErp(erp.role_name);
  const [m] = await db
    .insert(member)
    .values({ companyId: co.id, email, name: erp.name ?? email, role, title: erp.role_name ?? null })
    .onConflictDoUpdate({
      target: member.email,
      set: { name: erp.name ?? email, role, title: erp.role_name ?? null },
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

"use client";

import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { setRoleForm } from "./actions";

export const ROLE_OPTIONS = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;

const PILL: Record<string, string> = {
  SUPER_ADMIN: "bg-[#0b1020] text-[#d8a85a]",
  OWNER: "bg-[#0b1020] text-[#d8a85a]",
  ADMIN: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
  MANAGER: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  AGENT: "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]",
  SALES: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  VIEWER: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  DRIVER: "bg-[var(--color-pastel-cyan)] text-[var(--color-pastel-cyan-ink)]",
};

/**
 * The role as a coloured pill; choosing another one saves straight away and
 * holds through ERP syncs and sign-ins. A role set here can go back to the
 * ERP's ("Use ERP role").
 */
export function RoleSelect({
  email,
  name,
  role,
  canSuper,
  erpRole = null,
  setHere = false,
}: {
  email: string;
  name: string;
  role: string;
  /** The viewer may grant SUPER_ADMIN (they are one, or none exists yet). */
  canSuper: boolean;
  /** The role the ERP maps this person to, when they are in the ERP. */
  erpRole?: string | null;
  /** The current role was picked here rather than taken from the ERP. */
  setHere?: boolean;
}) {
  const { t } = useShell();
  const L = t.set;
  return (
    <form action={setRoleForm} className="flex flex-col items-start gap-0.5">
      <input type="hidden" name="email" value={email} />
      {/* Keyed by the saved role: after the form action React resets the form, which
          put the select back on the role it first rendered with until a reload. */}
      <select
        key={role}
        name="role"
        defaultValue={role}
        disabled={role === "SUPER_ADMIN" && !canSuper}
        aria-label={`Role for ${name}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`h-[28px] w-[128px] cursor-pointer appearance-none rounded-full border-0 bg-[length:10px] bg-[right_10px_center] bg-no-repeat px-3 text-[11px] font-semibold uppercase tracking-[0.04em] outline-none focus:shadow-[0_0_0_3px_var(--color-accent-ring)] ${PILL[role] ?? PILL.VIEWER}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23737c8c' stroke-width='1.5'/%3E%3C/svg%3E\")",
        }}
      >
        {(canSuper || role === "SUPER_ADMIN") && <option value="SUPER_ADMIN">SUPER ADMIN</option>}
        {role === "OWNER" && <option value="OWNER">OWNER</option>}
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        {setHere && erpRole && <option value="ERP">{fmt(L.useErpRole, { r: erpRole })}</option>}
      </select>
      {setHere && erpRole && erpRole !== role && (
        <span className="pl-3 text-[10px] text-[var(--color-faint)]">{fmt(L.roleErpWas, { r: erpRole })}</span>
      )}
    </form>
  );
}

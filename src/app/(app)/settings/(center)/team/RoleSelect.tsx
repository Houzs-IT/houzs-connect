"use client";

import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";
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
      <SearchableSelect
        key={role}
        name="role"
        defaultValue={role}
        submitOnChange
        disabled={role === "SUPER_ADMIN" && !canSuper}
        aria-label={`Role for ${name}`}
        className={`h-[28px] w-[128px] cursor-pointer appearance-none rounded-full border-0 bg-[length:10px] bg-[right_10px_center] bg-no-repeat px-3 text-[11px] font-semibold uppercase tracking-[0.04em] outline-none focus:shadow-[0_0_0_3px_var(--color-accent-ring)] ${PILL[role] ?? PILL.VIEWER}`}
        options={[
          ...(canSuper || role === "SUPER_ADMIN" ? [{ value: "SUPER_ADMIN", label: "SUPER ADMIN" }] : []),
          ...(role === "OWNER" ? [{ value: "OWNER", label: "OWNER" }] : []),
          ...ROLE_OPTIONS.map((r) => ({ value: r, label: r })),
          ...(setHere && erpRole ? [{ value: "ERP", label: fmt(L.useErpRole, { r: erpRole }) }] : []),
        ]}
      />
      {setHere && erpRole && erpRole !== role && (
        <span className="pl-3 text-[10px] text-[var(--color-faint)]">{fmt(L.roleErpWas, { r: erpRole })}</span>
      )}
    </form>
  );
}

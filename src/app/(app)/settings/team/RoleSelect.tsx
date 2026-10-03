"use client";

import { setRoleForm } from "./actions";

export const ROLE_OPTIONS = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;

const PILL: Record<string, string> = {
  OWNER: "bg-[#0b1020] text-[#d8a85a]",
  ADMIN: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
  MANAGER: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  AGENT: "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]",
  SALES: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  VIEWER: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  DRIVER: "bg-[var(--color-pastel-cyan)] text-[var(--color-pastel-cyan-ink)]",
};

/** The role as a coloured pill; choosing another one saves straight away. */
export function RoleSelect({ email, name, role }: { email: string; name: string; role: string }) {
  return (
    <form action={setRoleForm}>
      <input type="hidden" name="email" value={email} />
      <select
        name="role"
        defaultValue={role}
        aria-label={`Role for ${name}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`h-[28px] w-[128px] cursor-pointer appearance-none rounded-full border-0 bg-[length:10px] bg-[right_10px_center] bg-no-repeat px-3 text-[11px] font-semibold uppercase tracking-[0.04em] outline-none focus:shadow-[0_0_0_3px_var(--color-accent-ring)] ${PILL[role] ?? PILL.VIEWER}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23737c8c' stroke-width='1.5'/%3E%3C/svg%3E\")",
        }}
      >
        {role === "OWNER" && <option value="OWNER">OWNER</option>}
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import type { Capability, Matrix, MatrixRole } from "@/lib/permissions";
import { setPermission } from "./actions";

const PILL: Record<MatrixRole, string> = {
  SUPER_ADMIN: "bg-[#0b1020] text-[#d8a85a]",
  ADMIN: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
  MANAGER: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  AGENT: "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]",
  SALES: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  VIEWER: "text-[var(--color-muted)]",
  DRIVER: "bg-[var(--color-pastel-cyan)] text-[var(--color-pastel-cyan-ink)]",
};

/** The role × permission table; a Super Admin ticks a box and it saves. */
export function RolesMatrix({
  matrix,
  roles,
  caps,
  editable,
}: {
  matrix: Matrix;
  roles: readonly MatrixRole[];
  caps: readonly Capability[];
  editable: boolean;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.set;
  const [m, setM] = useState(matrix);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (r: MatrixRole, c: Capability) => {
    const next = !m[r][c];
    setM((x) => ({ ...x, [r]: { ...x[r], [c]: next } }));
    start(async () => {
      const res = await setPermission(r, c, next);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        setM((x) => ({ ...x, [r]: { ...x[r], [c]: !next } }));
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  return (
    <>
      <p className={`mb-3 text-[12.5px] ${error ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
        {error ?? (editable ? L.rolesEdit : L.rolesLocked)}
      </p>
      <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[860px] text-left">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{L.capability}</th>
              {roles.map((r) => (
                <th key={r} className="px-2 py-3 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] ${PILL[r]}`}>{r.replace("_", " ")}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => (
              <tr key={c} className="border-b border-[var(--color-border-subtle)] last:border-0">
                <td className="px-4 py-2.5">
                  <div className="text-[13px] font-medium text-[var(--color-ink)]">{L.caps[c]}</div>
                  <div className="text-[11px] text-[var(--color-faint)]">{L.capGroup[c]}</div>
                </td>
                {roles.map((r) => {
                  const on = r === "SUPER_ADMIN" || m[r][c];
                  const locked = !editable || r === "SUPER_ADMIN";
                  return (
                    <td key={r} className="px-2 py-2.5 text-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${r} ${L.caps[c]}`}
                        disabled={locked || pending}
                        onClick={() => toggle(r, c)}
                        className={`inline-grid h-[22px] w-[22px] place-items-center rounded-[6px] border text-[12px] transition-colors disabled:cursor-default ${
                          on ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)] bg-white text-transparent"
                        } ${!locked ? "hover:border-[var(--color-accent)]" : ""}`}
                      >
                        ✓
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

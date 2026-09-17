"use client";

import { useTransition } from "react";
import { setCompanyAccess, setPersonRole, type Person, type TeamCompany } from "./actions";
import { syncFromErp } from "../sync-actions";

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;

export function TeamClient({
  companies,
  people,
}: {
  companies: TeamCompany[];
  people: Person[];
}) {
  const [pending, start] = useTransition();

  const toggle = (p: Person, companyId: string, on: boolean) =>
    start(async () => {
      await setCompanyAccess({ email: p.email, name: p.name, role: p.role, companyId, on });
    });
  const changeRole = (p: Person, role: string) =>
    start(async () => {
      await setPersonRole({ email: p.email, role });
    });

  return (
    <div className="space-y-4">
      <form
        action={syncFromErp}
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-card"
      >
        <span className="text-[12px] text-[var(--color-muted)]">
          Pull the latest people, roles, departments and reporting from the Houzs ERP.
        </span>
        <button
          type="submit"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface)]"
        >
          Sync from ERP now
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
              <th className="px-4 py-2.5 font-medium">Person</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Department</th>
              <th className="px-4 py-2.5 font-medium">Reports to</th>
              {companies.map((c) => (
                <th key={c.id} className="px-3 py-2.5 text-center font-medium">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={pending ? "opacity-60" : undefined}>
            {people.map((p) => (
              <tr key={p.key} className="border-b border-[var(--color-border)] align-middle last:border-0">
                <td className="px-4 py-2.5">
                  <span className="block font-medium text-[var(--color-ink)]">{p.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-[var(--color-faint)]">{p.email}</span>
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={p.role}
                    onChange={(e) => changeRole(p, e.target.value)}
                    aria-label={`Role for ${p.name}`}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5 text-[var(--color-muted)]">{p.department ?? "—"}</td>
                <td className="px-4 py-2.5 text-[var(--color-muted)]">{p.reportsTo ?? "—"}</td>
                {companies.map((c) => {
                  const a = p.access[c.id];
                  const on = !!a;
                  const locked = !!a?.fromErp;
                  return (
                    <td key={c.id} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={locked || pending}
                        // Toggle from the known server state, not e.target.checked:
                        // the box is controlled and driven by an async action, so
                        // the event's checked value is unreliable and a revoke kept
                        // re-sending "on".
                        onChange={() => toggle(p, c.id, !on)}
                        aria-label={`${p.name} access to ${c.name}`}
                        title={
                          locked
                            ? "Granted by the Houzs ERP"
                            : on
                              ? "Granted here — click to remove"
                              : "Click to grant"
                        }
                        className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
                      />
                      {locked && (
                        <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
                          ERP
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        A tick means the person can read that company&apos;s inbox. <b>ERP</b> boxes are set by the
        Houzs ERP and locked here; the rest you grant or remove — that is the only way to give access
        to a Connect-only company like Hookka. The role applies to companies you grant here: ADMIN
        sees every chat in a company, AGENT only chats assigned to them.
      </p>
    </div>
  );
}

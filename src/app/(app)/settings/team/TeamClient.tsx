import { toggleAccess, setRoleForm, type Person, type TeamCompany } from "./actions";
import { syncFromErp } from "../sync-actions";

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;

// Server-rendered. Every control is a <form action={serverAction}> so it posts
// and works without depending on client hydration — the onChange + useTransition
// version left the checkboxes inert on the deployed page.
export function TeamClient({
  companies,
  people,
}: {
  companies: TeamCompany[];
  people: Person[];
}) {
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
          <tbody>
            {people.map((p) => (
              <tr key={p.key} className="border-b border-[var(--color-border)] align-middle last:border-0">
                <td className="px-4 py-2.5">
                  <span className="block font-medium text-[var(--color-ink)]">{p.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-[var(--color-faint)]">{p.email}</span>
                </td>
                <td className="px-4 py-2.5">
                  <form action={setRoleForm} className="flex items-center gap-1.5">
                    <input type="hidden" name="email" value={p.email} />
                    <select
                      name="role"
                      defaultValue={p.role}
                      aria-label={`Role for ${p.name}`}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-accent-ink)] transition-colors hover:bg-[var(--color-accent-soft)]"
                    >
                      Save
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2.5 text-[var(--color-muted)]">{p.department ?? "—"}</td>
                <td className="px-4 py-2.5 text-[var(--color-muted)]">{p.reportsTo ?? "—"}</td>
                {companies.map((c) => {
                  const a = p.access[c.id];
                  const on = !!a;
                  const locked = !!a?.fromErp;
                  if (locked) {
                    return (
                      <td key={c.id} className="px-3 py-2.5 text-center">
                        <span
                          className="inline-flex flex-col items-center"
                          title="Granted by the Houzs ERP"
                        >
                          <span className="grid h-5 w-5 place-items-center rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[12px] text-[var(--color-muted)]">
                            ✓
                          </span>
                          <span className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
                            ERP
                          </span>
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td key={c.id} className="px-3 py-2.5 text-center">
                      <form action={toggleAccess} className="inline-flex">
                        <input type="hidden" name="email" value={p.email} />
                        <input type="hidden" name="name" value={p.name} />
                        <input type="hidden" name="role" value={p.role} />
                        <input type="hidden" name="companyId" value={c.id} />
                        <input type="hidden" name="on" value={on ? "1" : "0"} />
                        <button
                          type="submit"
                          aria-label={`${p.name} access to ${c.name}`}
                          title={on ? "Granted — click to remove" : "Click to grant"}
                          className={`grid h-5 w-5 place-items-center rounded border text-[12px] transition-colors ${
                            on
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-transparent hover:border-[var(--color-accent)]"
                          }`}
                        >
                          ✓
                        </button>
                      </form>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        A green tick means the person can read that company&apos;s inbox — click to grant or remove.
        <b> ERP</b> boxes are set by the Houzs ERP and locked here; the rest are the only way to give
        access to a Connect-only company like Hookka. The role applies to companies you grant here:
        ADMIN sees every chat in a company, AGENT only chats assigned to them.
      </p>
    </div>
  );
}

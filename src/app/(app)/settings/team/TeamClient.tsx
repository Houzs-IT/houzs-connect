import { initials, tint } from "@/lib/format";
import type { Dict } from "@/lib/i18n/dict";
import { PersonAvatar } from "@/components/PersonAvatar";
import { toggleAccess, type Person, type TeamCompany } from "./actions";
import { syncFromErp } from "../sync-actions";
import { RoleSelect } from "./RoleSelect";

// Server-rendered. Access ticks are <form action={serverAction}> so they post
// without depending on client hydration; only the role pill is a client island.
export function TeamClient({
  companies,
  people,
  L,
  canSuper,
  requests,
}: {
  companies: TeamCompany[];
  people: Person[];
  L: Dict["set"];
  canSuper: boolean;
  requests: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {requests}

      <form action={syncFromErp} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#f0dcb4] bg-[#fdf6ea] px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-pastel-orange)] text-[14px] font-bold text-[var(--color-pastel-orange-ink)]">⇄</span>
        <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{L.syncNote}</span>
        <button
          type="submit"
          className="h-[34px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          ↻ {L.syncNow}
        </button>
      </form>

      <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">
              <th className="px-4 py-3">{L.person}</th>
              <th className="px-4 py-3">{L.role}</th>
              <th className="px-4 py-3">{L.department}</th>
              <th className="px-4 py-3">{L.reportsTo}</th>
              {companies.map((c) => (
                <th key={c.id} className="max-w-[110px] truncate px-3 py-3 text-center">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const c = tint(p.email);
              return (
                <tr key={p.key} className="border-b border-[var(--color-border-subtle)] align-middle last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar name={p.name} photo={p.photo} size={32}>
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                          style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                        >
                          {initials(p.name)}
                        </span>
                      </PersonAvatar>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[var(--color-ink)]">{p.name}</span>
                        <span className="block truncate font-code text-[11px] text-[var(--color-faint)]">{p.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleSelect email={p.email} name={p.name} role={p.role} canSuper={canSuper} />
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-ink)]">{p.department ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[var(--color-ink)]">{p.reportsTo ?? "—"}</td>
                  {companies.map((co) => {
                    const a = p.access[co.id];
                    const on = !!a;
                    if (a?.fromErp) {
                      return (
                        <td key={co.id} className="px-3 py-2.5 text-center">
                          <span className="inline-flex flex-col items-center" title="Granted by the Houzs ERP">
                            <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px] border border-[#e8c48e] bg-[#fdf1e0] text-[12px] text-[var(--color-pastel-orange-ink)]">✓</span>
                            <span className="mt-0.5 text-[9px] font-semibold tracking-[0.06em] text-[var(--color-pastel-orange-ink)]">{L.erp}</span>
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={co.id} className="px-3 py-2.5 text-center">
                        <form action={toggleAccess} className="inline-flex">
                          <input type="hidden" name="email" value={p.email} />
                          <input type="hidden" name="name" value={p.name} />
                          <input type="hidden" name="role" value={p.role} />
                          <input type="hidden" name="companyId" value={co.id} />
                          <input type="hidden" name="on" value={on ? "1" : "0"} />
                          <button
                            type="submit"
                            aria-label={`${p.name} access to ${co.name}`}
                            className={`grid h-[22px] w-[22px] place-items-center rounded-[6px] border text-[12px] transition-colors ${
                              on
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                                : "border-[var(--color-border-strong)] bg-white text-transparent hover:border-[var(--color-accent)]"
                            }`}
                          >
                            ✓
                          </button>
                        </form>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--color-faint)]">{L.teamHint}</p>
    </div>
  );
}

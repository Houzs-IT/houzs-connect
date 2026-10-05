import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { initials, tint } from "@/lib/format";
import type { Dict } from "@/lib/i18n/dict";
import { toggleAccess, type Person, type TeamCompany } from "./actions";
import { syncFromErp } from "../sync-actions";
import { RoleSelect } from "./RoleSelect";
import { TeamPhoto } from "./TeamPhoto";

/** Highest first when sorting by role. */
const ROLE_RANK = ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER", "SALES", "AGENT", "DRIVER", "VIEWER"];

// Server-rendered rows. Access ticks are <form action={serverAction}> so they
// post without depending on client hydration; the role pill is a client island,
// and DataTable (client) only orders, searches and filters the rendered rows.
export function TeamClient({
  companies,
  people,
  L,
  roles,
  canSuper,
  requests,
}: {
  companies: TeamCompany[];
  people: Person[];
  L: Dict["set"];
  /** Role code → its name (t.role). */
  roles: Record<string, string>;
  canSuper: boolean;
  requests: React.ReactNode;
}) {
  const columns: DataColumn[] = [
    { key: "person", label: L.person },
    { key: "role", label: L.role },
    { key: "department", label: L.department },
    { key: "reportsTo", label: L.reportsTo },
    ...companies.map((c) => ({ key: `co:${c.id}`, label: c.name, align: "center" as const, className: "max-w-[130px]" })),
  ];
  const rows: DataRow[] = people.map((p) => {
    const c = tint(p.email);
    const access = Object.fromEntries(
      companies.map((co) => {
        const a = p.access[co.id];
        return [`co:${co.id}`, a?.fromErp ? L.accessErp : a ? L.accessYes : L.accessNo];
      })
    );
    const accessRank = Object.fromEntries(
      companies.map((co) => {
        const a = p.access[co.id];
        return [`co:${co.id}`, a?.fromErp ? 0 : a ? 1 : 2];
      })
    );
    return {
      id: p.key,
      search: p.email,
      sort: {
        person: p.name,
        role: ROLE_RANK.indexOf(p.role) === -1 ? 99 : ROLE_RANK.indexOf(p.role),
        department: p.department,
        reportsTo: p.reportsTo,
        ...accessRank,
      },
      text: {
        person: p.name,
        role: roles[p.role] ?? p.role,
        department: p.department,
        reportsTo: p.reportsTo,
        ...access,
      },
      cells: {
        person: (
          <div className="flex items-center gap-2.5">
            <TeamPhoto email={p.email} name={p.name} photo={p.photo}>
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
              >
                {initials(p.name)}
              </span>
            </TeamPhoto>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--color-ink)]">{p.name}</span>
              <span className="block truncate font-code text-[11px] text-[var(--color-faint)]">{p.email}</span>
            </span>
          </div>
        ),
        role: <RoleSelect email={p.email} name={p.name} role={p.role} canSuper={canSuper} />,
        department: <span className="text-[var(--color-ink)]">{p.department ?? "—"}</span>,
        reportsTo: <span className="text-[var(--color-ink)]">{p.reportsTo ?? "—"}</span>,
        ...Object.fromEntries(companies.map((co) => [`co:${co.id}`, accessCell(p, co, L)])),
      },
    };
  });

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

      <DataTable columns={columns} rows={rows} minWidth={760} stateKey="team" searchPlaceholder={L.teamSearch} />

      <p className="text-[12px] leading-relaxed text-[var(--color-faint)]">{L.teamHint}</p>
    </div>
  );
}

/** One company's access tick: locked when the ERP granted it, a toggle otherwise. */
function accessCell(p: Person, co: TeamCompany, L: Dict["set"]) {
  const a = p.access[co.id];
  const on = !!a;
  if (a?.fromErp) {
    return (
      <span className="inline-flex flex-col items-center" title="Granted by the Houzs ERP">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[6px] border border-[#e8c48e] bg-[#fdf1e0] text-[12px] text-[var(--color-pastel-orange-ink)]">✓</span>
        <span className="mt-0.5 text-[9px] font-semibold tracking-[0.06em] text-[var(--color-pastel-orange-ink)]">{L.erp}</span>
      </span>
    );
  }
  return (
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
  );
}

import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { initials, tint } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { MODULES, type Module } from "@/lib/module-access";
import { resetAccess, toggleModule, type AccessPerson } from "./actions";

// Server-rendered like the Team page: each tick is a <form action={serverAction}>,
// so it posts without waiting for the page to hydrate; DataTable only orders,
// searches and filters the rows.
export async function AccessTable({ people, canEdit, meEmail }: { people: AccessPerson[]; canEdit: boolean; meEmail: string }) {
  const t = await getDict();
  const L = t.set;
  const label = (m: Module) => (m === "settings" ? L.accessCompanySettings : t.nav[m]);

  const columns: DataColumn[] = [
    { key: "person", label: L.accessPerson },
    { key: "role", label: L.role },
    ...MODULES.map((m) => ({ key: m, label: label(m), align: "center" as const, className: "max-w-[110px]" })),
    { key: "actions", label: "", sort: false, filter: false, align: "right" as const, className: "w-[96px]" },
  ];

  const rows: DataRow[] = people.map((p) => {
    const c = tint(p.email);
    const locked = !canEdit || p.role === "SUPER_ADMIN";
    return {
      id: p.email,
      search: p.email,
      sort: { person: p.name, role: p.role, ...Object.fromEntries(MODULES.map((m) => [m, p.modules.includes(m) ? 0 : 1])) },
      text: { person: p.name, role: t.role[p.role as keyof typeof t.role] ?? p.role, ...Object.fromEntries(MODULES.map((m) => [m, p.modules.includes(m) ? "✓" : "—"])) },
      cells: {
        person: (
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
            >
              {initials(p.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--color-ink)]">
                {p.name}
                {p.email.toLowerCase() === meEmail.toLowerCase() ? <span className="ml-1.5 text-[11px] font-normal text-[var(--color-faint)]">(you)</span> : null}
              </span>
              <span className="block truncate font-code text-[11px] text-[var(--color-faint)]">{p.email}</span>
            </span>
          </div>
        ),
        role: (
          <span className="flex flex-col items-start gap-0.5">
            <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-ink)]">
              {t.role[p.role as keyof typeof t.role] ?? p.role}
            </span>
            {p.custom && <span className="pl-1 text-[10.5px] font-semibold text-[var(--color-accent)]">{L.accessCustom}</span>}
          </span>
        ),
        ...Object.fromEntries(MODULES.map((m) => [m, tick(p, m, locked)])),
        actions:
          canEdit && p.custom ? (
            <form action={resetAccess}>
              <input type="hidden" name="email" value={p.email} />
              <button
                type="submit"
                className="h-[28px] rounded-[8px] border border-[var(--color-border)] px-2.5 text-[12px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {L.accessUseRole}
              </button>
            </form>
          ) : null,
      },
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <DataTable columns={columns} rows={rows} minWidth={1180} stateKey="access" searchPlaceholder={L.teamSearch} />
      <p className="text-[12px] leading-relaxed text-[var(--color-faint)]">
        {canEdit ? L.accessSuperAll : L.accessOnlySuper}
      </p>
    </div>
  );
}

/** One module tick: a toggle for a Super Admin, read-only otherwise and for a Super Admin's own row. */
function tick(p: AccessPerson, m: Module, locked: boolean) {
  const on = p.modules.includes(m);
  const box = `grid h-[22px] w-[22px] place-items-center rounded-[6px] border text-[12px] transition-colors ${
    on ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)] bg-white text-transparent"
  }`;
  if (locked) {
    return (
      <span aria-label={`${p.name} ${m}: ${on ? "yes" : "no"}`} className={`inline-grid ${box} ${on ? "opacity-60" : ""}`}>
        ✓
      </span>
    );
  }
  return (
    <form action={toggleModule} className="inline-flex">
      <input type="hidden" name="email" value={p.email} />
      <input type="hidden" name="module" value={m} />
      <input type="hidden" name="on" value={on ? "1" : "0"} />
      <button type="submit" aria-label={`${p.name} ${m}`} className={`${box} hover:border-[var(--color-accent)]`}>
        ✓
      </button>
    </form>
  );
}

import { notFound } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { department, member } from "@/db/schema";
import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";

const TONES = ["blue", "green", "orange", "purple", "pink", "cyan"];

/** Departments of this company, as synced from Houzs ERP, with headcount. */
export default async function DepartmentsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const [depts, heads] = await Promise.all([
    db.query.department.findMany({ where: eq(department.companyId, me.companyId), orderBy: asc(department.name) }),
    db
      .select({ id: member.departmentId, n: count() })
      .from(member)
      .where(eq(member.companyId, me.companyId))
      .groupBy(member.departmentId),
  ]);
  const by = new Map(heads.map((h) => [h.id, h.n]));

  const columns: DataColumn[] = [
    { key: "name", label: L.department, filter: false },
    { key: "people", label: L.members, align: "right", className: "w-[160px]" },
  ];
  const rows: DataRow[] = depts.map((d, i) => {
    const tone = TONES[i % TONES.length];
    const n = by.get(d.id) ?? 0;
    return {
      id: d.id,
      sort: { name: d.name, people: n },
      text: { name: d.name, people: fmt(L.deptMembers, { n }) },
      cells: {
        name: (
          <div className="flex items-center gap-3">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold"
              style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
            >
              {d.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 truncate font-semibold text-[var(--color-ink)]">{d.name}</span>
          </div>
        ),
        people: <span className="tabular-nums text-[var(--color-muted)]">{fmt(L.deptMembers, { n })}</span>,
      },
    };
  });

  return (
    <PageChrome section="settings" crumbs={[L.departments]}>
      <div className="max-w-[1000px] p-4 md:p-6">
        <SettingsHead title={L.departments} sub={L.deptSub} />
        <DataTable columns={columns} rows={rows} minWidth={420} stateKey="settings-departments" empty={L.noDepts} />
      </div>
    </PageChrome>
  );
}

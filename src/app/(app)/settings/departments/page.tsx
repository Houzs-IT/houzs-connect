import { notFound } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { department, member } from "@/db/schema";
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

  return (
    <PageChrome section="settings" crumbs={[L.departments]}>
      <div className="max-w-[1000px] p-4 md:p-6">
        <SettingsHead title={L.departments} sub={L.deptSub} />
        {depts.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[13px] text-[var(--color-faint)]">{L.noDepts}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {depts.map((d, i) => {
              const tone = TONES[i % TONES.length];
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold"
                    style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                  >
                    {d.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{d.name}</div>
                    <div className="text-[12px] text-[var(--color-faint)]">{fmt(L.deptMembers, { n: by.get(d.id) ?? 0 })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageChrome>
  );
}

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company, department, member } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { initials, tint } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { SetCard, SettingsHead } from "../ui";

/** Who the signed-in person is in Connect — all of it from Houzs ERP. */
export default async function ProfilePage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const row = await db.query.member.findFirst({ where: eq(member.id, me.id) });
  const [dept, boss, grants] = await Promise.all([
    row?.departmentId ? db.query.department.findFirst({ where: eq(department.id, row.departmentId) }) : null,
    row?.managerId ? db.query.member.findFirst({ where: eq(member.id, row.managerId) }) : null,
    row
      ? db
          .select({ name: company.name })
          .from(member)
          .innerJoin(company, eq(company.id, member.companyId))
          .where(and(eq(member.email, row.email), eq(member.active, true)))
      : Promise.resolve([] as { name: string }[]),
  ]);
  const c = tint(me.name);
  const roles = t.role as Record<string, string>;
  const fields: [string, string][] = [
    [L.name, me.name],
    [L.email, row?.email ?? "—"],
    [L.role, roles[me.role] ?? me.role],
    [L.department, dept?.name ?? "—"],
    [L.reportsTo, boss?.name ?? "—"],
    [L.companies, grants.map((g) => g.name).join(", ") || "—"],
  ];

  return (
    <PageChrome section="settings" crumbs={[L.profile]}>
      <div className="max-w-[880px] p-4 md:p-6">
        <SettingsHead title={L.profile} sub={L.profileSub} />
        <SetCard title={me.name} sub={row?.email}>
          <div className="flex flex-col gap-4 border-t border-[var(--color-border-subtle)] p-4 md:flex-row">
            <span
              className="grid h-16 w-16 shrink-0 place-items-center rounded-full text-[20px] font-bold"
              style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
            >
              {initials(me.name)}
            </span>
            <dl className="grid flex-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {fields.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{k}</dt>
                  <dd className="mt-1 text-[13.5px] text-[var(--color-ink)]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-3 text-[12px] text-[var(--color-muted)]">{L.erpNote}</p>
        </SetCard>
      </div>
    </PageChrome>
  );
}

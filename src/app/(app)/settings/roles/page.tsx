import { PageChrome } from "@/components/PageChrome";
import { getDict } from "@/lib/i18n/server";
import { ProposalNote, SettingsHead } from "../ui";

/*
  The roles matrix from the redesign, shown read-only as the proposed starting
  point. Making it editable — and adding SUPER_ADMIN — needs a new enum value
  and a permissions table, which wait for approval.
*/

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "AGENT", "SALES", "VIEWER", "DRIVER"] as const;
const PILL: Record<(typeof ROLES)[number], string> = {
  SUPER_ADMIN: "bg-[#0b1020] text-[#d8a85a]",
  ADMIN: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
  MANAGER: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  AGENT: "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]",
  SALES: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  VIEWER: "text-[var(--color-muted)]",
  DRIVER: "bg-[var(--color-pastel-cyan)] text-[var(--color-pastel-cyan-ink)]",
};
const S = "SUPER_ADMIN", A = "ADMIN", M = "MANAGER", G = "AGENT", SL = "SALES", V = "VIEWER", D = "DRIVER";
const MATRIX: [string, string[]][] = [
  ["seeAll", [S, A, M, V]],
  ["reply", [S, A, M, G, SL]],
  ["assign", [S, A, M]],
  ["campaigns", [S, A, M]],
  ["automations", [S, A]],
  ["payments", [S, A, M]],
  ["reports", [S, A, M, SL, V]],
  ["delivery", [S, A, M, D]],
  ["settings", [S, A]],
  ["approveDept", [S, A, M]],
  ["approveFinal", [S]],
  ["manageSys", [S]],
];

export default async function RolesPage() {
  const t = await getDict();
  const L = t.set;
  return (
    <PageChrome section="settings" crumbs={[L.roles]}>
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={L.roles} sub={L.rolesSub} />
        <div className="mb-4">
          <ProposalNote L={L} body={L.rolesBody} />
        </div>
        <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{L.capability}</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-3 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] ${PILL[r]}`}>
                      {r.replace("_", " ")}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([cap, who]) => (
                <tr key={cap} className="border-b border-[var(--color-border-subtle)] last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="text-[13px] font-medium text-[var(--color-ink)]">{L.caps[cap]}</div>
                    <div className="text-[11px] text-[var(--color-faint)]">{L.capGroup[cap]}</div>
                  </td>
                  {ROLES.map((r) => {
                    const on = who.includes(r);
                    return (
                      <td key={r} className="px-2 py-2.5 text-center">
                        <span
                          aria-label={on ? "yes" : "no"}
                          className={`inline-grid h-[22px] w-[22px] place-items-center rounded-[6px] border text-[12px] ${
                            on ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-border-strong)] bg-white text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageChrome>
  );
}

import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";
import { fetchTeam } from "./actions";
import { TeamClient } from "./TeamClient";

// Membership and access change from another company's actions, so never serve a
// cached matrix.
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const view = await fetchTeam();

  return (
    <PageChrome section="settings" page="team">
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={L.teamTitle} sub={L.teamSub} />
        {!view.permitted ? (
          <p className="text-[13px] text-[var(--color-muted)]">{L.onlyAdmins}</p>
        ) : (
          <TeamClient companies={view.companies} people={view.people} L={L} />
        )}
      </div>
    </PageChrome>
  );
}

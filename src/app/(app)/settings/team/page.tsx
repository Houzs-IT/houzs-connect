import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { fetchTeam } from "./actions";
import { TeamClient } from "./TeamClient";

// Membership and access change from another company's actions, so never serve a
// cached matrix.
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await getCurrentMember();
  if (!me) notFound();

  const view = await fetchTeam();

  return (
    <PageChrome section="settings" page="team">
      <div className="p-6">
        {!view.permitted ? (
          <p className="text-[13px] text-[var(--color-muted)]">
            Only an owner or admin can manage team access.
          </p>
        ) : (
          <TeamClient companies={view.companies} people={view.people} />
        )}
      </div>
    </PageChrome>
  );
}

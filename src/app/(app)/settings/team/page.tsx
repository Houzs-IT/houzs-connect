import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { openRequests } from "@/lib/access-requests";
import { can, isAdminRole } from "@/lib/permissions";
import { SettingsHead } from "../ui";
import { fetchTeam } from "./actions";
import { InvitePerson } from "./InvitePerson";
import { AccessRequests } from "./AccessRequests";
import { TeamClient } from "./TeamClient";

// Membership and access change from another company's actions, so never serve a
// cached matrix.
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const [view, canDept, canFinal, requests, supers] = await Promise.all([
    fetchTeam(),
    can(me, "approveDept"),
    can(me, "approveFinal"),
    openRequests(me.companyId).catch(() => []),
    getDb().query.member.findFirst({ columns: { id: true }, where: sql`${member.role}::text = 'SUPER_ADMIN'` }),
  ]);
  // The first Super Admin can be named by an owner or admin; after that only a Super Admin can.
  const canSuper = me.role === "SUPER_ADMIN" || (!supers && isAdminRole(me.role));
  const block =
    (canDept || canFinal) && requests.length > 0 ? (
      <AccessRequests requests={requests} companies={view.companies} canDept={canDept} canFinal={canFinal} />
    ) : null;

  return (
    <PageChrome section="settings" page="team" actions={view.permitted ? <InvitePerson /> : undefined}>
      <div className="p-4 md:p-6">
        <SettingsHead title={L.teamTitle} sub={L.teamSub} />
        {!view.permitted ? (
          <div className="flex flex-col gap-4">
            {block}
            <p className="text-[13px] text-[var(--color-muted)]">{L.onlyAdmins}</p>
          </div>
        ) : (
          <TeamClient
            companies={view.companies}
            people={view.people}
            removed={view.removed}
            meEmail={me.email}
            L={L}
            roles={t.role}
            canSuper={canSuper}
            requests={block}
          />
        )}
      </div>
    </PageChrome>
  );
}

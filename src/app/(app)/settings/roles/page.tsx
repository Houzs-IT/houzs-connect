import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { CAPABILITIES, MATRIX_ROLES, can, companyMatrix } from "@/lib/permissions";
import { SettingsHead } from "../ui";
import { RolesMatrix } from "./RolesMatrix";

export const dynamic = "force-dynamic";

/** What each role can do in this company; a Super Admin can change it. */
export default async function RolesPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const [matrix, editable] = await Promise.all([companyMatrix(me.companyId), can(me, "manageSys")]);
  return (
    <PageChrome section="settings" crumbs={[L.roles]}>
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={L.roles} sub={L.rolesSub} />
        <RolesMatrix matrix={matrix} roles={MATRIX_ROLES} caps={CAPABILITIES} editable={editable} />
      </div>
    </PageChrome>
  );
}

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
    <PageChrome
      section="settings"
      crumbs={[L.roles]}
      actions={
        // The seven roles are the ones the ERP assigns; a new one would have no
        // people in it until the ERP knows it too.
        <button
          type="button"
          disabled
          title={L.newRoleHint}
          className="flex h-[34px] cursor-not-allowed items-center rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white opacity-50"
        >
          + {L.newRole}
        </button>
      }
    >
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={L.roles} sub={L.rolesSub} />
        <RolesMatrix matrix={matrix} roles={MATRIX_ROLES} caps={CAPABILITIES} editable={editable} />
      </div>
    </PageChrome>
  );
}

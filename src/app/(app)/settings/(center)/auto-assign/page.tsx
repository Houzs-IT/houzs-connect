// Auto-assign — whether a new customer chat that no automation is handling is
// handed to an available agent automatically (least open load, online first),
// instead of sitting unassigned until someone picks it up.

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAutoAssignTable } from "@/db/ensure-auto-assign";
import { autoAssign } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { companyPresence } from "@/lib/presence";
import { bypassReadCache } from "@/db/fresh";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";
import { AutoAssignForm } from "./AutoAssignForm";
import { isAdminRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AutoAssignPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  await ensureAutoAssignTable(db).catch(() => {});

  const [row, presence] = await Promise.all([
    db.query.autoAssign
      .findFirst({ where: and(eq(autoAssign.companyId, me.companyId), bypassReadCache()) })
      .catch(() => undefined),
    companyPresence(me.companyId).catch(() => []),
  ]);
  const t = await getDict();

  return (
    <PageChrome section="settings" page="autoAssign">
      <div className="max-w-[760px] p-4 md:p-6">
        <SettingsHead title={t.set.autoAssign} sub={t.set.aaSub} />
        <AutoAssignForm
          enabled={!!row?.enabled}
          canEdit={isAdminRole(me.role)}
          online={presence.filter((p) => p.online).length}
          total={presence.length}
          lastSaved={row ? { at: row.updatedAt.toISOString(), by: row.updatedBy } : null}
        />
      </div>
    </PageChrome>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { requireModule } from "@/lib/full-access";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";
import { fetchAccess } from "./actions";
import { AccessTable } from "./AccessTable";

// Ticks change from this page's own actions; never serve a cached matrix.
export const dynamic = "force-dynamic";

/** Settings → Access: who opens which module, in the company being worked in. */
export default async function AccessPage() {
  await requireModule("settings");
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const [view, co] = await Promise.all([
    fetchAccess(),
    getDb().query.company.findFirst({ columns: { name: true }, where: eq(company.id, me.companyId) }),
  ]);
  return (
    <PageChrome section="settings" page="access">
      <div className="p-4 md:p-6">
        <SettingsHead title={L.accessTitle} sub={fmt(L.accessSub, { company: co?.name ?? "" })} />
        <AccessTable people={view.people} canEdit={view.canEdit} meEmail={me.email} />
      </div>
    </PageChrome>
  );
}

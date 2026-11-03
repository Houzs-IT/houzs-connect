import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { NOTIFY_KINDS, loadPrefs } from "@/lib/notifications";
import { SettingsHead } from "../ui";
import { NotifyPrefs } from "./NotifyPrefs";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const prefs = await loadPrefs(me.id);
  return (
    <PageChrome section="settings" crumbs={[L.notifications]}>
      <div className="max-w-[880px] p-4 md:p-6">
        <SettingsHead title={L.notifications} sub={L.notifSub} />
        <NotifyPrefs initial={prefs} kinds={NOTIFY_KINDS} />
      </div>
    </PageChrome>
  );
}

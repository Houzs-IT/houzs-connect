import { PageChrome } from "@/components/PageChrome";
import { getDict } from "@/lib/i18n/server";
import { logout } from "@/app/login/actions";
import { SetCard, SettingsHead } from "../ui";

/** Sign-in is the Houzs ERP account; nothing here stores a password. */
export default async function SecurityPage() {
  const t = await getDict();
  const L = t.set;
  return (
    <PageChrome section="settings" crumbs={[L.security]}>
      <div className="flex max-w-[880px] flex-col gap-4 p-4 md:p-6">
        <SettingsHead title={L.security} sub={L.securitySub} />
        <SetCard icon="⚿" tone="pink" title={L.pwTitle} sub={L.fromErp}>
          <p className="border-t border-[var(--color-border-subtle)] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--color-muted)]">{L.pwBody}</p>
        </SetCard>
        <SetCard
          icon="◉"
          tone="blue"
          title={L.sessionTitle}
          sub={L.sessionBody}
          right={
            <form action={logout}>
              <button className="h-[34px] rounded-[8px] bg-[var(--color-danger-soft)] px-3.5 text-[13px] font-semibold text-[var(--color-danger)]">
                {L.signOut}
              </button>
            </form>
          }
        />
      </div>
    </PageChrome>
  );
}

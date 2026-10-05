import Link from "next/link";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { isAdminRole } from "@/lib/permissions";
import { ensureInternal, sidebar } from "./data";
import { ChannelView } from "./ChannelView";
import { InternalMenu } from "./InternalMenu";

export const dynamic = "force-dynamic";

/**
 * /internal — a phone opens on the list of channels and people; a desktop,
 * which already shows that list in the menu, opens the first channel.
 */
export default async function InternalPage() {
  const me = await getCurrentMember();
  if (!me) return null;
  await ensureInternal(me.companyId, me.id);
  const side = await sidebar(me.companyId, me.id, isAdminRole(me.role));
  const first = side.channels[0];
  const L = (await getDict()).internal;
  return (
    <>
      <div className="flex min-w-0 flex-1 md:hidden">
        <InternalMenu mobile />
      </div>
      <div className="hidden min-w-0 flex-1 md:flex">
        {first ? (
          <ChannelView channelId={first.id} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--color-surface)] text-center">
            <p className="text-[13px] text-[var(--color-muted)]">{L.noChannelsYet}</p>
            <Link href="/internal/browse" className="rounded-[8px] bg-[var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white">
              {L.browse}
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

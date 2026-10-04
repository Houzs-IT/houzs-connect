import { getCurrentMember } from "@/lib/current-member";
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
  const side = await sidebar(me.companyId, me.id);
  const first = side.channels[0];
  return (
    <>
      <div className="flex min-w-0 flex-1 md:hidden">
        <InternalMenu mobile />
      </div>
      <div className="hidden min-w-0 flex-1 md:flex">{first && <ChannelView channelId={first.id} />}</div>
    </>
  );
}

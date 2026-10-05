import Link from "next/link";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { isAdminRole } from "@/lib/permissions";
import { browseChannels, ensureInternal } from "../data";
import { BrowseList } from "./BrowseList";

export const dynamic = "force-dynamic";

/** Browse channels: every channel in the company, to join or ask to join. */
export default async function BrowsePage() {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.internal;
  await ensureInternal(me.companyId, me.id);
  const channels = await browseChannels(me.companyId, me.id);
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Link href="/internal" className="grid h-8 w-8 place-items-center text-[18px] text-[var(--color-muted)] md:hidden" aria-label={L.back}>
          ‹
        </Link>
        <h1 className="text-[16px] font-semibold text-[var(--color-ink)]">{L.browse}</h1>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <p className="mb-3 max-w-[640px] text-[12.5px] text-[var(--color-muted)]">{L.browseSub}</p>
        <BrowseList channels={channels} companyAdmin={isAdminRole(me.role)} />
      </div>
    </div>
  );
}

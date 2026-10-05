import Link from "next/link";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { companyPresence } from "@/lib/presence";
import { ensureInternal, searchMessages } from "../data";
import { MessageRow } from "../parts";

export const dynamic = "force-dynamic";

/** Messages across every channel and DM the viewer can see, or (?c=) in one channel. */
export default async function InternalSearch({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.internal;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const only = sp.c?.trim() || null;
  await ensureInternal(me.companyId, me.id);
  const [hits, people] = await Promise.all([q ? searchMessages(me.companyId, me.id, q, only) : Promise.resolve([]), companyPresence(me.companyId)]);
  const names = people.map((p) => p.name);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Link href="/internal" className="text-[18px] text-[var(--color-muted)] md:hidden" aria-label={L.back}>
          ‹
        </Link>
        <h1 className="text-[16px] font-semibold text-[var(--color-ink)]">{fmt(L.results, { q })}</h1>
        {only && hits[0] && <span className="text-[12.5px] text-[var(--color-faint)]">{fmt(L.inChannel, { c: hits[0].channelName })}</span>}
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)] py-2">
        {hits.length === 0 && <p className="px-5 py-12 text-center text-[13px] text-[var(--color-faint)]">{L.noResults}</p>}
        {hits.map((m) => (
          <Link key={m.id} href={`/internal/${m.channelId}${m.parentId ? `?t=${m.parentId}` : ""}`} className="block">
            <div className="px-5 pt-2 text-[11.5px] font-semibold text-[var(--color-faint)]">{fmt(L.inChannel, { c: m.channelName })}</div>
            <MessageRow m={m} names={names} L={L} compactCard />
          </Link>
        ))}
      </div>
    </div>
  );
}

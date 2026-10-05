import { fmt, type Dict } from "@/lib/i18n/dict";
import { photoSrcs } from "@/lib/member-photo";
import { companyPresence } from "@/lib/presence";
import { Avatar } from "./ui";

/** "6 online · 2 offline" pill, from member.last_seen_at (lib/presence.ts). */
export async function Presence({ companyId, s }: { companyId: string; s: Dict["dash"] }) {
  const people = await companyPresence(companyId);
  const p = {
    online: people.filter((x) => x.online),
    offline: people.filter((x) => !x.online).length,
  };
  const photos = await photoSrcs(p.online.slice(0, 3).map((x) => x.id));
  return (
    <span
      title={s.onlineTip}
      className="hidden h-[38px] items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] pl-1.5 pr-3.5 text-[12px] sm:flex"
    >
      {p.online.length > 0 && (
        <span className="flex pl-1.5">
          {p.online.slice(0, 3).map((x) => (
            <span key={x.id} className="-ml-1.5 rounded-full border-2 border-white">
              <Avatar name={x.name} photo={photos.get(x.id)} size={22} />
            </span>
          ))}
        </span>
      )}
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
      <b className="font-semibold text-[var(--color-ink)]">{fmt(s.online, { n: p.online.length })}</b>
      <span className="text-[var(--color-faint)]">· {fmt(s.offline, { n: p.offline })}</span>
    </span>
  );
}

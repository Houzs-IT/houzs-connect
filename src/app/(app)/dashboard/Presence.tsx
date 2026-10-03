import { fmt, type Dict } from "@/lib/i18n/dict";
import { teamPresence } from "./queries";
import { Avatar } from "./ui";

/** "6 online · 2 offline" pill, from the proxy in teamPresence(). */
export async function Presence({ companyId, s }: { companyId: string; s: Dict["dash"] }) {
  const p = await teamPresence(companyId);
  return (
    <span
      title={s.onlineTip}
      className="hidden h-[38px] items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] pl-1.5 pr-3.5 text-[12px] sm:flex"
    >
      {p.online.length > 0 && (
        <span className="flex pl-1.5">
          {p.online.slice(0, 3).map((n) => (
            <span key={n} className="-ml-1.5 rounded-full border-2 border-white">
              <Avatar name={n} size={22} />
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

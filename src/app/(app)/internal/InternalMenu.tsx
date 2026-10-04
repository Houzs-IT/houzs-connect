import Link from "next/link";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { companyPresence } from "@/lib/presence";
import { ensureInternal, sidebar } from "./data";
import { NavLink } from "./NavLink";
import { NewChat } from "./NewChat";
import { Avatar } from "./parts";

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10.5px] font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Channels, direct messages and customer discussions. On desktop it is the
 * 232px menu beside the chat; `mobile` renders it full width as the list
 * screen a phone opens on.
 */
export async function InternalMenu({ mobile = false }: { mobile?: boolean }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.internal;
  await ensureInternal(me.companyId, me.id);
  const [side, people] = await Promise.all([sidebar(me.companyId, me.id), companyPresence(me.companyId)]);
  const online = new Map(people.map((p) => [p.id, p.online]));
  const others = people.filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name, online: p.online }));

  // "Houzs Century_Azza" -> "Azza", "Peter Lim" -> "Peter".
  const short = (n: string) => (n.split("_").pop() ?? n).split(" ")[0];
  const preview = (by: string | null, body: string | null) => (body ? `${by ? `${short(by)}: ` : ""}${body}` : "");

  if (mobile) {
    const head = (title: string) => (
      <div className="px-4 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">{title}</div>
    );
    const row = (href: string, icon: React.ReactNode, name: string, sub: string, n: number) => (
      <Link key={href} href={href} className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3">
        {icon}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14.5px] text-[var(--color-ink)] ${n ? "font-bold" : "font-semibold"}`}>{name}</span>
          {sub && <span className="block truncate text-[13px] text-[var(--color-muted)]">{sub}</span>}
        </span>
        <Badge n={n} />
      </Link>
    );
    return (
      <div className="flex w-full flex-col bg-[var(--color-surface)]">
        <div className="flex h-14 shrink-0 items-center gap-2 pl-4 pr-3">
          <span className="flex-1 text-[19px] font-bold text-[var(--color-ink)]">{L.title}</span>
          <Link href="/internal/search" aria-label={L.search} className="grid h-10 w-10 place-items-center text-[18px] text-[var(--color-ink)]">
            ⌕
          </Link>
          <NewChat people={others} />
        </div>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
          {head(L.channels)}
          {side.channels.map((c) =>
            row(
              `/internal/${c.id}`,
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[16px] font-semibold text-[var(--color-ink)]">#</span>,
              c.name,
              preview(c.lastBy, c.lastBody),
              c.unread
            )
          )}
          {head(L.dms)}
          {side.dms.map((d) =>
            row(
              `/internal/${d.id}`,
              <span className="relative shrink-0">
                <Avatar name={d.otherName} size={40} />
                <span
                  className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                    online.get(d.otherId) ? "bg-[var(--color-success)]" : "bg-[var(--color-border-strong)]"
                  }`}
                />
              </span>,
              d.otherName,
              preview(null, d.lastBody),
              d.unread
            )
          )}
          {side.discussions.length > 0 && head(L.discussions)}
          {side.discussions.map((d) =>
            row(
              `/internal/${d.channelId}?t=${d.messageId}`,
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[14px] text-[var(--color-accent)]">◌</span>,
              d.orderRef ? `${d.name} · ${d.orderRef}` : d.name,
              "",
              0
            )
          )}
        </nav>
      </div>
    );
  }

  const group = (title: string) => (
    <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">{title}</div>
  );

  return (
    <div
      className={
        mobile
          ? "flex w-full flex-col bg-[var(--color-surface-2)]"
          : "hidden w-[232px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)] md:flex"
      }
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] pl-4 pr-3">
        <span className="text-[15px] font-semibold text-[var(--color-ink)]">{L.title}</span>
        <NewChat people={others} />
      </div>
      <nav className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4 pt-3">
        <form action="/internal/search" className="mb-1 flex h-[34px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5">
          <span className="text-[13px] text-[var(--color-faint)]">⌕</span>
          <input name="q" placeholder={L.search} className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]" />
        </form>

        {group(L.channels)}
        {side.channels.map((c, i) => (
          <NavLink key={c.id} href={`/internal/${c.id}`} fallback={i === 0}>
            <span className="text-[var(--color-faint)]">#</span>
            <span className={`min-w-0 flex-1 truncate ${c.unread ? "font-semibold" : ""}`}>{c.name}</span>
            <Badge n={c.unread} />
          </NavLink>
        ))}

        {group(L.dms)}
        {side.dms.map((d) => (
          <NavLink key={d.id} href={`/internal/${d.id}`}>
            <span className="relative">
              <Avatar name={d.otherName} size={20} />
              {online.get(d.otherId) && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-[var(--color-success)]" />
              )}
            </span>
            <span className={`min-w-0 flex-1 truncate ${d.unread ? "font-semibold" : ""}`}>{d.otherName}</span>
            <Badge n={d.unread} />
          </NavLink>
        ))}

        {side.discussions.length > 0 && (
          <>
            {group(L.discussions)}
            {side.discussions.map((d) => (
              <NavLink key={d.conversationId} href={`/internal/${d.channelId}?t=${d.messageId}`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[10px] text-[var(--color-accent)]">◌</span>
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.orderRef && <span className="text-[11.5px] font-semibold text-[var(--color-brand)]">{d.orderRef}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>
    </div>
  );
}

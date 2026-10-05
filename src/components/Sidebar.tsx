"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { initials, tint } from "@/lib/format";
import { PersonAvatar } from "./PersonAvatar";
import { useShell } from "./shell/ShellProvider";
import { NAV, SETTINGS_NAV, isActive, type NavItem } from "./shell/nav";

/**
 * One 40×40 icon tile.
 *
 * Lives in its own component because `useLinkStatus` only reports for the Link
 * it is rendered under. The moment a link is clicked it goes `pending`, so the
 * tile adopts the active treatment and raises a petrol dot — the click is
 * acknowledged instantly even though the destination is still rendering on the
 * server. Route skeletons take over from there.
 */
function RailTile({
  Icon,
  active,
  badge,
}: {
  Icon: NavItem["Icon"];
  active: boolean;
  badge?: number;
}) {
  const { pending } = useLinkStatus();
  const lit = active || pending;
  return (
    <span
      className={`relative grid h-10 w-10 place-items-center rounded-[8px] transition-colors duration-150 ${
        lit
          ? "bg-[var(--color-rail-active)] text-white shadow-[inset_0_0_0_1px_rgba(231,234,228,0.12)]"
          : "text-[var(--color-rail-icon)] group-hover/link:bg-[var(--color-rail-2)] group-hover/link:text-white"
      }`}
    >
      {/* 2px petrol indicator, flush with the rail's left edge (12px out). */}
      {lit && (
        <span className="absolute -left-3 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-[2px] bg-[var(--color-accent)]" />
      )}
      <Icon width={18} height={18} />
      {pending && !active && (
        <span className="nav-pending absolute bottom-1 right-1" aria-hidden />
      )}
      {badge ? (
        <span className="absolute right-0.5 top-[3px] grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9.5px] font-semibold text-white shadow-[0_0_0_2px_var(--color-rail)]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The 64px icon rail (desktop only — phones get MobileTabBar).
 * Top: logo + modules. Foot: Settings, the WhatsApp live dot, the signed-in
 * member's avatar.
 */
export function Sidebar({
  unread,
  live,
  me,
}: {
  unread?: number;
  live?: boolean;
  me: { name: string; photo?: string | null };
}) {
  const path = usePathname();
  const { t } = useShell();

  const tile = (item: NavItem, badge?: number) => (
    <Link
      key={item.key}
      href={item.href}
      title={t.nav[item.key]}
      aria-label={t.nav[item.key]}
      aria-current={isActive(item, path) ? "page" : undefined}
      className="group/link block rounded-[8px]"
    >
      <RailTile Icon={item.Icon} active={isActive(item, path)} badge={badge} />
    </Link>
  );

  return (
    <aside className="bg-rail relative hidden w-16 shrink-0 flex-col items-center gap-1 pb-3 pt-3.5 md:flex">
      {/* Brass hairline on the right edge. */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-[rgba(161,106,46,0.35)] to-transparent" />

      <Link
        href="/inbox"
        aria-label="Houzs Connect"
        className="mb-3.5 grid h-9 w-9 place-items-center rounded-[8px] bg-white shadow-[var(--shadow-logo)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-hc-mark.png" alt="" className="h-[22px] w-[22px] object-contain" />
      </Link>

      <nav className="flex flex-col items-center gap-1">
        {NAV.map((item) => tile(item, item.key === "inbox" ? unread : undefined))}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2.5">
        {tile(SETTINGS_NAV)}
        {/* Read from WHATSAPP_MODE, never hardcoded — an operator trusts this
            dot, so it must not claim LIVE while WhatsApp is stubbed. */}
        <span
          title={live ? t.shell.live : t.shell.demo}
          className={`h-1.5 w-1.5 rounded-full ${
            live ? "bg-[var(--color-success)]" : "bg-[var(--color-rail-faint)]"
          }`}
        />
        <Link href="/settings/profile" title={me.name} aria-label={me.name} className="block rounded-full">
          <PersonAvatar name={me.name} photo={me.photo} size={32}>
            <span
              className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: tint(me.name) }}
            >
              {initials(me.name).toUpperCase()}
            </span>
          </PersonAvatar>
        </Link>
      </div>
    </aside>
  );
}

"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconInbox,
  IconContacts,
  IconAutomation,
  IconCampaign,
  IconForm,
  IconSettings,
  IconReceipt,
  IconPhone,
} from "./icons";

type NavItem = {
  href: string;
  label: string;
  Icon: typeof IconDashboard;
  badge?: boolean;
};

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
      { href: "/inbox", label: "Inbox", Icon: IconInbox, badge: true },
      { href: "/contacts", label: "Contacts", Icon: IconContacts },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/automations", label: "Automations", Icon: IconAutomation },
      { href: "/settings/auto-replies", label: "Auto Replies", Icon: IconAutomation },
      { href: "/payments", label: "Payments", Icon: IconReceipt },
      { href: "/campaigns", label: "Campaigns", Icon: IconCampaign },
      { href: "/templates", label: "Templates", Icon: IconForm },
      { href: "/forms", label: "WhatsApp Forms", Icon: IconForm },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/logs", label: "System Logs", Icon: IconReceipt },
      { href: "/settings/numbers", label: "Phone Numbers", Icon: IconPhone },
      { href: "/settings", label: "Settings", Icon: IconSettings },
    ],
  },
];

/**
 * The row inside a nav `<Link>`.
 *
 * Lives in its own component because `useLinkStatus` only reports for the Link
 * it is rendered under. The moment a link is clicked it goes `pending`, so the
 * row adopts the active treatment and raises a petrol dot — the click is
 * acknowledged instantly even though the destination is still rendering on the
 * server. Route skeletons take over from there.
 */
function NavRow({
  label,
  Icon,
  active,
  badge,
  unread,
}: {
  label: string;
  Icon: NavItem["Icon"];
  active: boolean;
  badge?: boolean;
  unread?: number;
}) {
  const { pending } = useLinkStatus();
  const lit = active || pending;

  return (
    <span
      className={`group relative flex items-center gap-3 rounded-[6px] pl-3 pr-1.5 py-2 text-[12.5px] font-medium transition-colors duration-150 ${
        lit
          ? "bg-[var(--color-rail-active)] text-white shadow-[inset_0_0_0_1px_rgba(231,234,228,0.12)]"
          : "text-[var(--color-rail-ink)] group-hover/link:bg-[var(--color-rail-2)] group-hover/link:text-white"
      }`}
    >
      {lit && (
        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[var(--color-accent)]" />
      )}
      <Icon
        width={15}
        height={15}
        className={lit ? "text-[var(--color-accent)]" : "text-current"}
      />
      <span className="flex-1">{label}</span>
      {pending && <span className="nav-pending" aria-hidden />}
      {badge && unread ? (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white">
          {unread}
        </span>
      ) : null}
    </span>
  );
}

export function Sidebar({ unread, live }: { unread?: number; live?: boolean }) {
  const path = usePathname();
  return (
    <aside className="relative flex w-[236px] shrink-0 flex-col bg-[var(--color-rail)] text-[var(--color-rail-ink)]">
      {/* Brass hairline on the right edge — same refined separator as the ERP. */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-gradient-to-b from-transparent via-[rgba(161,106,46,0.35)] to-transparent" />

      {/* Brand header — Houzs Century wordmark, whitewashed for the dark rail,
          identical treatment to the ERP sidebar. "Chat" marks this app. */}
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-wordmark.png"
          alt="Houzs Century"
          className="h-9 w-auto max-w-[150px] object-contain brightness-0 invert"
        />
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-brand text-[var(--color-brand-bright)]">
          Chat
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-4 px-3 py-1">
        {SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-rail-faint)]">
              {section.title}
            </div>
            {section.items.map(({ href, label, Icon, badge }) => {
              const active = path === href || path.startsWith(href + "/");
              return (
                <Link key={href} href={href} className="group/link block">
                  <NavRow
                    label={label}
                    Icon={Icon}
                    active={active}
                    badge={badge}
                    unread={unread}
                  />
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Read from WHATSAPP_MODE, never hardcoded — this line said "DEMO MODE"
          for the first hour the number was actually live, which is exactly the
          kind of label an operator trusts and should not have to second-guess. */}
      <div className="flex items-center gap-2 px-5 py-4 font-mono text-[10px] text-[var(--color-rail-faint)]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            live ? "bg-[var(--color-success)]" : "bg-[var(--color-rail-faint)]"
          }`}
        />
        {live ? "LIVE · sending via WhatsApp" : "DEMO MODE · WhatsApp stubbed"}
      </div>
    </aside>
  );
}

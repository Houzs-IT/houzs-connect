"use client";

import Link from "next/link";
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
      { href: "/payments", label: "Payments", Icon: IconReceipt },
      { href: "/campaigns", label: "Campaigns", Icon: IconCampaign },
      { href: "/forms", label: "WhatsApp Forms", Icon: IconForm },
    ],
  },
  {
    title: "System",
    items: [{ href: "/settings", label: "Settings", Icon: IconSettings }],
  },
];

export function Sidebar({ unread }: { unread?: number }) {
  const path = usePathname();
  return (
    <aside className="flex w-[236px] shrink-0 flex-col bg-[var(--color-rail)] text-[var(--color-rail-ink)]">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-5">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-[7px] border border-[rgba(216,168,90,0.45)] font-mono text-[12px] font-semibold text-[var(--color-brand-bright)]">
          HC
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-[var(--color-rail-ink)]">
            Houzs Connect
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-rail-faint)]">
            Ink &amp; Petrol
          </div>
        </div>
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
                <Link
                  key={href}
                  href={href}
                  className={`group relative flex items-center gap-3 rounded-[6px] pl-3 pr-1.5 py-2 text-[12.5px] font-medium transition-colors duration-150 ${
                    active
                      ? "bg-[var(--color-rail-active)] text-white shadow-[inset_0_0_0_1px_rgba(231,234,228,0.12)]"
                      : "text-[var(--color-rail-ink)] hover:bg-[var(--color-rail-2)] hover:text-white"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[var(--color-accent)]" />
                  )}
                  <Icon
                    width={15}
                    height={15}
                    className={
                      active ? "text-[var(--color-accent)]" : "text-current"
                    }
                  />
                  <span className="flex-1">{label}</span>
                  {badge && unread ? (
                    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white">
                      {unread}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 font-mono text-[10px] text-[var(--color-rail-faint)]">
        DEMO MODE · WhatsApp stubbed
      </div>
    </aside>
  );
}

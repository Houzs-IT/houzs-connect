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

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { href: "/inbox", label: "Inbox", Icon: IconInbox, badge: true },
  { href: "/contacts", label: "Contacts", Icon: IconContacts },
  { href: "/automations", label: "Automations", Icon: IconAutomation },
  { href: "/payments", label: "Payments", Icon: IconReceipt },
  { href: "/campaigns", label: "Campaigns", Icon: IconCampaign },
  { href: "/forms", label: "WhatsApp Forms", Icon: IconForm },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function Sidebar({ unread }: { unread?: number }) {
  const path = usePathname();
  return (
    <aside className="flex w-[236px] shrink-0 flex-col bg-[var(--color-rail)] text-[var(--color-rail-ink)]">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--color-accent)] font-bold text-[#1b1a17]">
          H
        </div>
        <div className="leading-tight">
          <div className="font-semibold tracking-tight text-white">
            Houzs Connect
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-rail-faint)]">
            Comms · OS
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.map(({ href, label, Icon, badge }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                active
                  ? "bg-[var(--color-rail-2)] text-white"
                  : "text-[var(--color-rail-ink)] hover:bg-[var(--color-rail-2)]/60 hover:text-white"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[var(--color-accent-hi)]" />
              )}
              <Icon
                width={18}
                height={18}
                className={active ? "text-[var(--color-accent-hi)]" : ""}
              />
              <span className="flex-1">{label}</span>
              {badge && unread ? (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-[#1b1a17]">
                  {unread}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 font-mono text-[10px] text-[var(--color-rail-faint)]">
        DEMO MODE · WhatsApp stubbed
      </div>
    </aside>
  );
}

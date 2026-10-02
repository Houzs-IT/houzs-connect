"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import {
  IconAutomation,
  IconClose,
  IconDashboard,
  IconInbox,
  IconInternal,
  IconLogout,
  IconMenu,
} from "../icons";
import { NAV, SETTINGS_NAV, isActive, type NavItem } from "./nav";
import { useShell } from "./ShellProvider";
import { LangToggle } from "./TopbarControls";

type Tab = { href: string; label: string; Icon: NavItem["Icon"]; match: string[]; badge?: number };

/** Modules reached through "More" rather than a tab of their own. */
const MORE_KEYS = ["contacts", "campaigns", "templates", "payments", "logs"] as const;
const MORE: NavItem[] = [
  ...NAV.filter((n) => (MORE_KEYS as readonly string[]).includes(n.key)),
  SETTINGS_NAV,
];

function TabCell({
  label,
  Icon,
  on,
  badge,
}: {
  label: string;
  Icon: NavItem["Icon"];
  on: boolean;
  badge?: number;
}) {
  return (
    <span
      className={`relative flex min-h-12 flex-col items-center gap-[3px] py-1.5 ${
        on ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"
      }`}
    >
      <Icon width={22} height={22} />
      <span className="text-[10.5px] font-semibold">{label}</span>
      {badge ? (
        <span className="absolute left-1/2 top-0.5 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9.5px] font-semibold text-white shadow-[0_0_0_2px_var(--color-surface)]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Phone navigation: Service · Internal · Home · Flows · More. Everything else
 * opens from the More sheet, together with the language switch and sign out.
 *
 * Hidden inside an open conversation (`/inbox/<id>`): the thread carries its own
 * back control and needs the height for the composer.
 */
export function MobileTabBar({ unread }: { unread?: number }) {
  const path = usePathname();
  const { t } = useShell();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (/^\/inbox\/[^/]+/.test(path)) return null;

  const tabs: Tab[] = [
    { href: "/inbox", label: t.tab.inbox, Icon: IconInbox, match: ["/inbox"], badge: unread },
    { href: "/internal", label: t.tab.internal, Icon: IconInternal, match: ["/internal"] },
    { href: "/dashboard", label: t.tab.home, Icon: IconDashboard, match: ["/dashboard"] },
    { href: "/automations", label: t.tab.flows, Icon: IconAutomation, match: ["/automations"] },
  ];
  const on = (m: string[]) => m.some((p) => path === p || path.startsWith(p + "/"));
  const moreOn = MORE.some((n) => isActive(n, path));

  return (
    <>
      <nav className="flex shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 md:hidden">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="flex-1" aria-current={on(tab.match) ? "page" : undefined}>
            <TabCell label={tab.label} Icon={tab.Icon} on={on(tab.match)} badge={tab.badge} />
          </Link>
        ))}
        <button type="button" className="flex-1" aria-expanded={open} onClick={() => setOpen(true)}>
          <TabCell label={t.tab.more} Icon={IconMenu} on={moreOn || open} />
        </button>
      </nav>

      {/* More sheet. Kept mounted and slid off-screen so the open/close
          animation runs; pointer events drop while closed. */}
      <div className={`fixed inset-0 z-50 md:hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-label={t.shell.close}
          onClick={() => setOpen(false)}
          className={`absolute inset-0 h-full w-full bg-[rgba(11,16,32,0.45)] transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          role="dialog"
          aria-label={t.tab.more}
          className={`absolute inset-x-0 bottom-0 rounded-t-[18px] bg-[var(--color-surface)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-modal)] transition-transform duration-200 ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[15px] font-semibold text-[var(--color-ink)]">{t.tab.more}</span>
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              aria-label={t.shell.close}
              className="grid h-11 w-11 place-items-center rounded-[8px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
            >
              <IconClose width={18} height={18} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {MORE.map((n) => {
              const lit = isActive(n, path);
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 text-center text-[12px] font-medium ${
                    lit
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                      : "border-[var(--color-border)] text-[var(--color-ink)]"
                  }`}
                >
                  <n.Icon width={20} height={20} />
                  <span className="leading-tight">{t.nav[n.key]}</span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-3">
            <span className="text-[13px] text-[var(--color-muted)]">{t.shell.language}</span>
            <LangToggle />
          </div>
          <form action={logout} className="mt-2">
            <button
              type="submit"
              tabIndex={open ? 0 : -1}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              <IconLogout width={15} height={15} />
              {t.shell.signOut}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

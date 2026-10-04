import Link from "next/link";
import type { CompanyChoice } from "@/lib/companies";
import { CompanySwitcher, LangToggle, MenuExpandButton, UserMenu } from "./shell/TopbarControls";
import { OnlinePeople } from "./shell/OnlinePeople";
import { NotifyBell } from "./shell/NotifyBell";

export type Crumb = string | { label: string; href: string };

/**
 * The 56px page header: breadcrumbs on the left; language, then the signed-in
 * member (whose menu holds the company switcher and sign out) on the right.
 *
 * On a phone only the last crumb shows, as the page title — the language
 * switch and the rest of the navigation live in the tab bar's "More" sheet.
 *
 * No notification bell yet: there is no notification feed to point it at, and
 * a bell that never rings is worse than none (same reason the old fake search
 * box was removed).
 */
export function Topbar({
  crumbs,
  mobileTitle,
  actions,
  center,
  current,
  companies,
}: {
  crumbs: Crumb[];
  /** Centred in the bar on desktop — page tabs (e.g. System Logs). */
  center?: React.ReactNode;
  /** Page-level buttons, right of the language switch (e.g. Import, Add). */
  actions?: React.ReactNode;
  /** Phone title; defaults to the last crumb. */
  mobileTitle?: string;
  current: { name: string; role: string; department?: { name: string } | null };
  /** Companies this person may work in (src/lib/companies.ts). The switcher
   *  only appears when there is somewhere else to go. */
  companies?: CompanyChoice[];
}) {
  const last = crumbs[crumbs.length - 1];
  const lastLabel = typeof last === "string" ? last : last?.label;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <MenuExpandButton />

      <h1 className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-ink)] md:hidden">
        {mobileTitle ?? lastLabel}
      </h1>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] md:flex">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const label = typeof c === "string" ? c : c.label;
          return (
            <span key={i} className="flex min-w-0 items-center gap-2">
              {i > 0 && <span className="text-[var(--color-border-strong)]">/</span>}
              {isLast ? (
                <span className="truncate font-semibold text-[var(--color-ink)]" aria-current="page">
                  {label}
                </span>
              ) : typeof c === "string" ? (
                <span className="truncate text-[var(--color-muted)]">{label}</span>
              ) : (
                <Link href={c.href} className="truncate text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {center && <div className="mx-auto hidden md:flex">{center}</div>}

      <div className={`${center ? "md:ml-0" : ""} ml-auto flex items-center gap-2`}>
        <CompanySwitcher companies={companies} className="hidden md:block" />
        <OnlinePeople className="hidden lg:block" />
        <LangToggle className="hidden md:flex" />
        {actions}
        <NotifyBell />
        <UserMenu
          current={{ name: current.name, role: current.role, department: current.department?.name }}
          companies={companies}
        />
      </div>
    </header>
  );
}

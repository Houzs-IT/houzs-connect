"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconPanelClose } from "../icons";
import { useShell } from "./ShellProvider";

export type MenuItem = {
  href: string;
  label: string;
  count?: number | string;
  /** Colour dot before the label (status, tag, source). */
  dot?: string;
  /** Extra prefixes that should also light this item. */
  match?: string[];
  /** Light only on an exact path match (e.g. `/settings` vs `/settings/team`). */
  exact?: boolean;
};

export type MenuGroup = { title?: string; items: MenuItem[] };

function hrefActive(item: MenuItem, path: string, search: string) {
  const [p, q] = item.href.split("?");
  if (q) return path === p && search === q; // a filter link: path AND query
  if (item.exact) return path === p;
  return [p, ...(item.match ?? [])].some(
    (m) => path === m || path.startsWith(m + "/")
  );
}

/**
 * The 208px module menu between the rail and the page (desktop only).
 * Each module's layout fills it with its own sub-pages or filters. Collapsing
 * it is remembered per browser; while collapsed, the Topbar shows the
 * "show menu" button — found through the `data-secondary-menu` marker below,
 * so pages without a menu never show a dead button.
 */
export function SecondaryMenu({
  title,
  groups,
  footer,
}: {
  title: string;
  groups: MenuGroup[];
  footer?: React.ReactNode;
}) {
  const { t, menuCollapsed, setMenuCollapsed } = useShell();
  const path = usePathname();
  const search = useSearchParams().toString();

  if (menuCollapsed) return <span data-secondary-menu hidden />;

  return (
    <div
      data-secondary-menu
      className="hidden w-[208px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)] md:flex"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] pl-4 pr-3">
        <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          {title}
        </div>
        <button
          type="button"
          onClick={() => setMenuCollapsed(true)}
          title={t.shell.collapse}
          aria-label={t.shell.collapse}
          className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-dim)] hover:text-[var(--color-ink)]"
        >
          <IconPanelClose width={16} height={16} />
        </button>
      </div>

      <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
        {groups.map((g, gi) => (
          <div key={g.title ?? gi} className="flex flex-col gap-px">
            {g.title && (
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
                {g.title}
              </div>
            )}
            {g.items.map((item) => {
              const on = hrefActive(item, path, search);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12.5px] transition-colors ${
                    on
                      ? "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)]"
                      : "font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-dim)]"
                  }`}
                >
                  {item.dot && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: item.dot }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count != null && (
                    <span className="text-[11px] tabular-nums text-[var(--color-faint)]">
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {footer && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">{footer}</div>
      )}
    </div>
  );
}

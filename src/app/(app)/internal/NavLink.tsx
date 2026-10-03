"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** A menu row that lights up while its channel (and thread, if given) is open. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const t = useSearchParams().get("t");
  const [p, q] = href.split("?");
  const on = path === p && (!q || q === `t=${t}`);
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`flex items-center gap-2 rounded-[8px] px-2 py-[7px] text-[13px] transition-colors ${
        on ? "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)]" : "font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-dim)]"
      }`}
    >
      {children}
    </Link>
  );
}

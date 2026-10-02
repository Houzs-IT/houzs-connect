"use client";

import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { switchCompany } from "@/app/company-actions";
import type { CompanyChoice } from "@/lib/companies";
import { initials, tint } from "@/lib/format";
import { IconChevronDown, IconLogout, IconPanelOpen } from "../icons";
import { useShell } from "./ShellProvider";

/**
 * "Show menu" — only visible while this page HAS a secondary menu and it is
 * collapsed. Visibility is pure CSS (`.menu-expand` in globals.css keys off the
 * menu's hidden marker), so it is right on the very first paint.
 */
export function MenuExpandButton() {
  const { t, setMenuCollapsed } = useShell();
  return (
    <button
      type="button"
      onClick={() => setMenuCollapsed(false)}
      title={t.shell.expand}
      aria-label={t.shell.expand}
      className="menu-expand hidden h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
    >
      <IconPanelOpen width={16} height={16} />
    </button>
  );
}

/** EN / 中文 segmented switch. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useShell();
  const seg = (on: boolean) =>
    `cursor-pointer rounded-[6px] px-2.5 py-[3px] text-[12px] font-semibold transition-colors ${
      on
        ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,24,16,0.1)]"
        : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
    }`;
  return (
    <div
      role="group"
      aria-label="Language"
      className={`flex rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5 ${className}`}
    >
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} className={seg(lang === "en")}>
        EN
      </button>
      <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")} className={seg(lang === "zh")}>
        中文
      </button>
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: tint(name), width: size, height: size, fontSize: size >= 32 ? 12 : 11 }}
    >
      {initials(name).toUpperCase()}
    </span>
  );
}

/**
 * Avatar + name + role, opening a menu with the company switcher and sign out
 * (both used to sit loose in the Topbar). Each company choice is a plain form
 * POST the server re-checks against the same eligibility list.
 */
export function UserMenu({
  current,
  companies,
}: {
  current: { name: string; role: string; department?: string | null };
  companies?: CompanyChoice[];
}) {
  const { t } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const role = t.role[current.role] ?? current.role;
  const sub = current.department ? `${role} · ${current.department}` : role;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[8px] py-1 pl-1 pr-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <Avatar name={current.name} />
        <span className="hidden leading-[1.25] sm:block">
          <span className="block text-[13px] font-medium text-[var(--color-ink)]">{current.name}</span>
          <span className="block text-[11px] text-[var(--color-faint)]">{sub}</span>
        </span>
        <IconChevronDown width={14} height={14} className="hidden text-[var(--color-faint)] sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-56 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]"
        >
          {companies && companies.length > 1 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
                {t.shell.company}
              </div>
              {companies.map((c) => (
                <form key={c.id} action={switchCompany}>
                  <input type="hidden" name="companyId" value={c.id} />
                  <button
                    type="submit"
                    role="menuitem"
                    disabled={c.current}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:font-semibold disabled:text-[var(--color-accent-ink)] disabled:hover:bg-transparent"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.current && (
                      <span className="text-[11px] font-normal text-[var(--color-faint)]">{t.shell.current}</span>
                    )}
                  </button>
                </form>
              ))}
              <div className="my-1 border-t border-[var(--color-border-subtle)]" />
            </>
          )}
          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              <IconLogout width={15} height={15} />
              {t.shell.signOut}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

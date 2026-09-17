import { logout } from "@/app/login/actions";
import { switchCompany } from "@/app/company-actions";
import type { CompanyChoice } from "@/lib/companies";
import { initials, tint } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  SALES: "Sales",
  DRIVER: "Driver",
  VIEWER: "Viewer",
};

export function Topbar({
  title,
  subtitle,
  current,
  companies,
}: {
  title: string;
  subtitle?: string;
  current: { id: string; name: string; role: string; title: string | null };
  /** Companies this person may work in (src/lib/companies.ts). The switcher only
   *  appears when there is somewhere else to go. */
  companies?: CompanyChoice[];
}) {
  const here = companies?.find((c) => c.current);
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] pl-14 pr-3 md:gap-4 md:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--color-ink)] md:text-[17px]">
          {title}
        </h1>
        {subtitle && (
          <p className="hidden truncate text-xs text-[var(--color-muted)] sm:block">{subtitle}</p>
        )}
      </div>

      {/* There was a "Search…" box here. It was a <div> — no input, no handler,
          no destination — sitting in the chrome of every page and looking
          exactly like the search field in the inbox rail, which is real. There
          is no global search to point it at, so it is gone rather than faked.
          Search lives where it works: the conversation rail, and the phone
          filter on Contacts. */}
      <div className="ml-auto flex items-center gap-1.5 md:gap-3">
        {companies && companies.length > 1 && here && (
          // A <details> menu of plain forms: no client JavaScript, and each choice
          // is a POST the server re-checks against the same eligibility list.
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] md:gap-2 md:px-3 md:py-2">
              <span className="hidden text-[var(--color-faint)] sm:inline">Company</span>
              <span className="max-w-[92px] truncate md:max-w-none">{here.name}</span>
              <span aria-hidden className="text-[var(--color-faint)]">▾</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
              {companies.map((c) => (
                <form key={c.id} action={switchCompany}>
                  <input type="hidden" name="companyId" value={c.id} />
                  <button
                    type="submit"
                    disabled={c.current}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:text-[var(--color-faint)] disabled:hover:bg-transparent"
                  >
                    <span>{c.name}</span>
                    {c.current && <span className="text-[11px]">current</span>}
                  </button>
                </form>
              ))}
            </div>
          </details>
        )}
        <div className="flex items-center gap-1.5 md:gap-2.5">
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ background: tint(current.name) }}
          >
            {initials(current.name).toUpperCase()}
          </div>
          <div className="hidden leading-tight sm:block">
            <div className="text-[13px] font-medium text-[var(--color-ink)]">
              {current.name}
            </div>
            <div className="text-[11px] text-[var(--color-faint)]">
              {ROLE_LABEL[current.role] ?? current.role}
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] md:px-3 md:py-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

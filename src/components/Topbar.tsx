import { logout } from "@/app/login/actions";
import { initials, tint } from "@/lib/format";
import { IconSearch } from "./icons";

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
}: {
  title: string;
  subtitle?: string;
  current: { id: string; name: string; role: string; title: string | null };
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-ink)]">
          {title}
        </h1>
        {subtitle && (
          <p className="truncate text-xs text-[var(--color-muted)]">{subtitle}</p>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-faint)] md:flex">
          <IconSearch width={16} height={16} />
          <span>Search…</span>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white"
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
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

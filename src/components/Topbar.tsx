import { db } from "@/lib/db";
import { actAsMember } from "@/app/actions";
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

export async function Topbar({
  title,
  subtitle,
  current,
}: {
  title: string;
  subtitle?: string;
  current: { id: string; name: string; role: string; title: string | null };
}) {
  const members = await db.member.findMany({ orderBy: { name: "asc" } });

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

        {/* Dev "act as" switcher — proves org-chart RBAC. Replaced by SSO later. */}
        <form action={actAsMember} className="flex items-center gap-2">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ background: tint(current.name) }}
          >
            {initials(current.name).toUpperCase()}
          </div>
          <select
            name="memberId"
            defaultValue={current.id}
            className="max-w-[190px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {ROLE_LABEL[m.role] ?? m.role}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-ink)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            View as
          </button>
        </form>
      </div>
    </header>
  );
}

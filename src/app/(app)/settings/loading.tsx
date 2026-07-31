import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/** Card shell matching settings' `Card` (header strip + body). */
function SettingsCardSkeleton({
  title,
  subtitle,
  rows,
  gridCols = false,
}: {
  title: string;
  subtitle: string;
  rows: number;
  gridCols?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</h3>
        <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">{subtitle}</p>
      </div>
      <div
        className={
          gridCols
            ? "skeleton-stagger grid grid-cols-1 divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-y-0"
            : "skeleton-stagger divide-y divide-[var(--color-border)]"
        }
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-2.5"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="h-[18px] w-16 shrink-0" />
            <Skel className="h-[14px] min-w-0 flex-1" />
            <Skel className="h-[22px] w-14 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
        <Skel className="skeleton-strong h-[37px] min-w-0 flex-1 rounded-lg" />
        <Skel className="skeleton-strong h-[37px] w-16 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Settings loading state — four count tiles, the two-up quick-replies/tags
 * cards, the contact-fields card, and the org-chart table.
 */
export default function SettingsLoading() {
  const tiles = ["Team members", "Custom fields", "Tags", "Quick replies"];

  return (
    <PageSkeleton
      title="Settings"
      subtitle="Org chart, custom fields, tags, quick replies"
    >
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((label) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <Skel className="h-[26px] w-10" />
              <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SettingsCardSkeleton
            title="Quick replies"
            subtitle={"Typed after “/” in the composer."}
            rows={4}
          />
          <SettingsCardSkeleton
            title="Tags"
            subtitle="Label conversations and contacts."
            rows={4}
          />
        </div>

        <SettingsCardSkeleton
          title="Contact fields"
          subtitle="The CRM attribute schema synced from ERP orders."
          rows={6}
          gridCols
        />

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Org chart &amp; roles
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
              Synced from the Houzs ERP staff directory each time someone signs in.
            </p>
          </div>
          <TableSkeleton
            headers={["Member", "Role", "Department", "Reports to"]}
            widths={["w-32", "w-20", "w-24", "w-28"]}
            rows={6}
            dense
          />
        </div>
      </div>
    </PageSkeleton>
  );
}

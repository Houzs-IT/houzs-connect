import { PageSkeleton, Skel, StatTileSkeleton } from "@/components/skeleton";

/**
 * Dashboard loading state — the Overview tab's shape: a six-tile KPI grid over
 * two half-width cards. The tab strip renders for real (the labels are static),
 * so the page is recognisable and navigable-looking the instant it is clicked.
 */
export default function DashboardLoading() {
  const tabs = [
    "Overview",
    "Support",
    "Marketing",
    "Live Reporting",
    "Message Analytics",
  ];

  return (
    <PageSkeleton section="dashboard" page="overview">
      <div className="p-6">
        <div className="mb-5 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
          {tabs.map((t, i) => (
            <span
              key={t}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${
                i === 0
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-transparent text-[var(--color-muted)]"
              }`}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <StatTileSkeleton key={i} />
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <Skel className="mb-4 h-[15px] w-48" />
            <div className="skeleton-stagger flex flex-col gap-3">
              {[70, 88, 54, 40].map((pct, i) => (
                <div
                  key={pct}
                  className="flex items-center gap-3"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <Skel className="h-[13px] w-28 shrink-0" />
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="skeleton h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <Skel className="h-[13px] w-16 shrink-0" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <Skel className="mb-4 h-[15px] w-24" />
            <div className="grid grid-cols-2 gap-4">
              <StatTileSkeleton />
              <StatTileSkeleton />
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

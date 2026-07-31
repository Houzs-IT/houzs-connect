import { PageSkeleton, Skel } from "@/components/skeleton";

/** One automation card placeholder — same box model as the real `<Link>` card. */
function AutomationCardSkeleton({ i }: { i: number }) {
  return (
    <div
      className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="flex items-start justify-between">
        <Skel className="h-9 w-9 rounded-lg" />
        <Skel className="h-[19px] w-14 rounded-full" />
      </div>
      <Skel className="mt-3 h-[17px] w-44" />
      <Skel className="mt-1 h-[14px] w-56" />
      <Skel className="mt-2 h-[14px] w-full" />
      <Skel className="mt-1 h-[14px] w-2/3" />
      <div className="mt-3 border-t border-[var(--color-border)] pt-2">
        <Skel className="h-[13px] w-28" />
      </div>
    </div>
  );
}

/**
 * Automations loading state — the two-column card grid, plus the static
 * "Visual flow builder" tile rendered verbatim (it has no data, so there is no
 * reason to shimmer it).
 */
export default function AutomationsLoading() {
  return (
    <PageSkeleton
      title="Automations"
      subtitle="Trigger → node-graph flows · the follow-up engine"
    >
      <div className="p-6">
        <div className="skeleton-stagger grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <AutomationCardSkeleton key={i} i={i} />
          ))}

          <div className="dot-grid grid min-h-[168px] place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-center">
            <div className="px-6">
              <p className="text-[13px] font-medium text-[var(--color-ink)]">
                Visual flow builder
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                Open an automation to build its flow — searchable node palette,
                trigger, criteria router, messaging and tagging nodes, draft /
                live publishing, and version history.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

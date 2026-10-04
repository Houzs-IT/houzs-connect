import { PageSkeleton, Skel } from "@/components/skeleton";

/** Automations list loading state: search row over the table's shape. */
export default function AutomationsLoading() {
  return (
    <PageSkeleton section="automations" page="allFlows">
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <Skel className="h-[38px] w-[320px] rounded-[8px]" />
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="h-10 border-b border-[var(--color-border)]" />
          <div className="skeleton-stagger">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5"
                style={{ "--i": i } as React.CSSProperties}
              >
                <Skel className="h-9 w-9 rounded-[10px]" />
                <div className="flex-1">
                  <Skel className="h-[14px] w-48" />
                  <Skel className="mt-1.5 h-[11px] w-20" />
                </div>
                <Skel className="h-[14px] w-32" />
                <Skel className="h-[18px] w-24" />
                <Skel className="h-[22px] w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

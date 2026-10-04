import { PageSkeleton, Skel } from "@/components/skeleton";

/** Campaigns list loading state: search + date row over the table's shape. */
export default function CampaignsLoading() {
  return (
    <PageSkeleton section="campaigns" page="allCampaigns">
      <div className="flex flex-col gap-3.5 p-4 md:p-6">
        <div className="flex gap-2">
          <Skel className="h-[36px] w-[300px] rounded-[8px]" />
          <Skel className="h-[36px] w-[150px] rounded-[8px]" />
        </div>
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="h-10 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <div className="skeleton-stagger">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5"
                style={{ "--i": i } as React.CSSProperties}
              >
                <Skel className="h-9 w-9 rounded-full" />
                <div className="flex-1">
                  <Skel className="h-[14px] w-48" />
                  <Skel className="mt-1.5 h-[16px] w-24" />
                </div>
                <Skel className="h-[14px] w-28" />
                <Skel className="h-[18px] w-52" />
                <Skel className="h-[14px] w-20" />
                <Skel className="h-[18px] w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

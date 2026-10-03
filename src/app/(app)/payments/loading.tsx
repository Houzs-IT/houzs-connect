import { PageSkeleton, Skel } from "@/components/skeleton";

/** Payments loading state: KPI row, then the queue beside the review panel. */
export default function PaymentsLoading() {
  return (
    <PageSkeleton section="payments" page="receipts">
      <div className="flex flex-col gap-4 p-4">
        <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} className="h-[78px] rounded-[12px]" />
          ))}
        </div>
        <div className="flex gap-4">
          <div className="w-full overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] lg:w-[360px]">
            <div className="border-b border-[var(--color-border)] p-3">
              <Skel className="h-[36px] w-full rounded-[8px]" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
                <Skel className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skel className="h-[14px] w-32" />
                  <Skel className="mt-1.5 h-[11px] w-24" />
                </div>
              </div>
            ))}
          </div>
          <Skel className="hidden h-[620px] flex-1 rounded-[12px] lg:block" />
        </div>
      </div>
    </PageSkeleton>
  );
}

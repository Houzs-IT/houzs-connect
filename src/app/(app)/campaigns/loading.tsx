import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/**
 * Campaigns loading state — the six-step wizard beside the history table.
 *
 * This page is `force-dynamic` and its first paint waits on a Graph call for the
 * approved template list, so the skeleton is what an operator actually looks at
 * for a moment. It mirrors the real layout: the step strip, one field block, the
 * guidance panels, then the wide history table whose headers are static and so
 * render for real.
 */
export default function CampaignsLoading() {
  return (
    <PageSkeleton title="Campaigns" subtitle="One-time WhatsApp broadcasts">
      <div className="p-6">
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          {/* Wizard */}
          <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="mb-4 flex flex-wrap gap-1">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skel key={i} className="h-[24px] w-[68px] rounded-md" />
              ))}
            </div>
            <Skel className="mb-1 h-[13px] w-28" />
            <Skel className="mb-3 h-[33px] w-full rounded-lg" />
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <Skel className="h-[86px] w-full rounded-lg" />
              <Skel className="h-[86px] w-full rounded-lg" />
            </div>
            <Skel className="mb-3 h-[13px] w-40" />
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <Skel className="mb-2 h-[26px] w-full" />
              <div className="flex gap-2">
                <Skel className="h-[37px] w-[72px] rounded-lg" />
                <Skel className="h-[37px] w-[72px] rounded-lg" />
                <Skel className="h-[37px] w-[104px] rounded-lg" />
              </div>
            </div>
          </div>

          {/* History */}
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <Skel className="h-[33px] w-[200px] rounded-lg" />
              <Skel className="h-[33px] w-[140px] rounded-lg" />
              <Skel className="h-[33px] w-[140px] rounded-lg" />
              <Skel className="h-[33px] w-[72px] rounded-lg" />
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <TableSkeleton
                minWidth="min-w-[1080px]"
                headers={[
                  "Campaign",
                  "Channel",
                  "Sent to",
                  "People",
                  "Messages sent",
                  "Read",
                  "Wrote back",
                  "Schedule",
                  "Started",
                  "Ended",
                  "Status",
                  "Approval",
                  "Action",
                ]}
                widths={[
                  "w-36",
                  "w-20",
                  "w-24",
                  "w-10",
                  "w-10",
                  "w-6",
                  "w-6",
                  "w-24",
                  "w-24",
                  "w-24",
                  "w-16",
                  "w-20",
                  "w-24",
                ]}
                rows={7}
              />
            </div>
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/**
 * Campaigns loading state — the composer column beside the history table.
 * Table headers are static, so they render for real.
 */
export default function CampaignsLoading() {
  return (
    <PageSkeleton title="Campaigns" subtitle="One-time WhatsApp broadcasts">
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        {/* Composer */}
        <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skel className="mb-3 h-[16px] w-32" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-3">
              <Skel className="mb-1 h-[13px] w-24" />
              <Skel className="h-[33px] w-full rounded-lg" />
            </div>
          ))}
          <Skel className="mb-3 h-[13px] w-28" />
          <Skel className="mb-3 h-[92px] w-full rounded-lg" />
          <Skel className="h-[37px] w-full rounded-lg" />
        </div>

        {/* History */}
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <TableSkeleton
            minWidth="min-w-[720px]"
            headers={[
              "Campaign",
              "Audience",
              "Recipients",
              "Sent",
              "Read",
              "Replied",
              "When",
              "Status",
            ]}
            widths={[
              "w-36",
              "w-16",
              "w-10",
              "w-10",
              "w-10",
              "w-10",
              "w-20",
              "w-16",
            ]}
            rows={7}
          />
        </div>
      </div>
    </PageSkeleton>
  );
}

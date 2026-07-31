import { PageSkeleton, Skel } from "@/components/skeleton";

/**
 * WhatsApp Forms loading state. The "New form" panel on the left is a static
 * server action form with no data behind it, so it is rendered as its real
 * shape; only the form list on the right shimmers.
 */
export default function FormsLoading() {
  return (
    <PageSkeleton
      title="WhatsApp Forms"
      subtitle="In-chat data-collection forms (LIVE = Meta WhatsApp Flows)"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">
            New form
          </h3>
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">Name</div>
          <Skel className="mb-3 h-[33px] w-full rounded-lg" />
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">
            Fields — one per line: key | label | type
          </div>
          <Skel className="mb-3 h-[104px] w-full rounded-lg" />
          <Skel className="h-[37px] w-full rounded-lg" />
        </div>

        <div className="skeleton-stagger flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className="flex items-center justify-between">
                <Skel className="h-[17px] w-40" />
                <div className="flex items-center gap-2">
                  <Skel className="h-[19px] w-16 rounded-full" />
                  <Skel className="h-[22px] w-20 rounded-md" />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["w-40", "w-32", "w-36"].map((w) => (
                  <Skel key={w} className={`h-[22px] ${w} rounded-md`} />
                ))}
              </div>
              <div className="mt-3 border-t border-[var(--color-border)] pt-2">
                <Skel className="h-[13px] w-36" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}

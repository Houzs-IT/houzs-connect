import { PageSkeleton, Skel } from "@/components/skeleton";

/**
 * WhatsApp Forms loading state. The "New form" panel on the left is a static
 * server action form with no data behind it, so it is rendered as its real
 * shape; only the form list on the right shimmers.
 */
export default function FormsLoading() {
  return (
    <PageSkeleton section="templates" page="forms">
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card">
          <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">
            New form
          </h3>
          <p className="mb-3 text-[11px] text-[var(--color-faint)]">
            It starts as a draft. You add the questions on the next screen, and
            nothing reaches a customer until you put it in use.
          </p>
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">Name</div>
          <Skel className="mb-3 h-[33px] w-full rounded-lg" />
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">
            Questions (optional — one per line)
          </div>
          <Skel className="mb-1.5 h-[86px] w-full rounded-lg" />
          <Skel className="mb-3 h-[26px] w-full" />
          <Skel className="h-[37px] w-full rounded-lg" />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Skel className="h-[14px] w-48" />
          <div className="skeleton-stagger flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <Skel className="h-[17px] w-40" />
                    <Skel className="h-[19px] w-14 rounded-full" />
                  </div>
                  <Skel className="mt-1.5 h-[14px] w-56" />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {["w-40", "w-32", "w-36"].map((w) => (
                      <Skel key={w} className={`h-[22px] ${w} rounded-md`} />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
                  <Skel className="mr-auto h-[13px] w-56" />
                  <Skel className="h-[27px] w-[84px] rounded-lg" />
                  <Skel className="h-[27px] w-[72px] rounded-lg" />
                  <Skel className="h-[27px] w-[88px] rounded-lg" />
                  <Skel className="h-[27px] w-[56px] rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

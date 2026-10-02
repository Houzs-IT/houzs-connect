import Link from "next/link";
import { PageSkeleton, Skel } from "@/components/skeleton";

/**
 * One form's loading state. The back link, the section headings and the
 * preview's caption are real text — only the name, the questions and the
 * answers table shimmer, so nothing reflows when the data lands.
 */
export default function FormDetailLoading() {
  return (
    <PageSkeleton section="templates" page="forms">
      <div className="flex flex-col gap-6 p-6">
        <div>
          <Link
            href="/forms"
            className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            ← All forms
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Skel className="h-[21px] w-48" />
            <Skel className="h-[19px] w-14 rounded-full" />
            <Skel className="h-[13px] w-40" />
            <div className="ml-auto flex items-center gap-1.5">
              <Skel className="h-[31px] w-[86px] rounded-lg" />
              <Skel className="h-[31px] w-[104px] rounded-lg" />
              <Skel className="h-[31px] w-[68px] rounded-lg" />
            </div>
          </div>
          <Skel className="mt-1.5 h-[14px] w-[420px] max-w-full" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
                  Questions
                </h3>
                <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                  What the customer is asked, and where each answer is filed.
                </p>
              </div>
              <Skel className="h-[31px] w-[62px] rounded-lg" />
            </div>
            <div className="p-4">
              <div className="mb-1 text-[11px] text-[var(--color-muted)]">
                Form name
              </div>
              <Skel className="mb-4 h-[33px] w-full rounded-lg" />
              <div className="skeleton-stagger flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[var(--color-border)] p-2.5"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <Skel className="h-[13px] w-20" />
                      <Skel className="h-[13px] w-16" />
                    </div>
                    <Skel className="mb-1.5 h-[33px] w-full rounded-lg" />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Skel className="h-[33px] rounded-lg" />
                      <Skel className="h-[33px] rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
              <Skel className="mt-2 h-[37px] w-full rounded-lg" />
            </div>
          </div>

          <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
            <p className="mb-2 text-[11px] text-[var(--color-faint)]">
              What the customer sees in WhatsApp
            </p>
            <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
              <div className="border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5">
                <Skel className="h-[15px] w-32" />
              </div>
              <div className="flex flex-col gap-3 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <Skel className="mb-1 h-[14px] w-28" />
                    <Skel className="h-[30px] w-full rounded-lg" />
                  </div>
                ))}
                <Skel className="mt-1 h-[35px] w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Answers
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
              What customers sent back. Each answer is also saved onto that
              customer&apos;s contact details.
            </p>
          </div>
          <div className="skeleton-stagger">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-3 last:border-0"
                style={{ "--i": i } as React.CSSProperties}
              >
                <Skel className="h-[14px] w-40" />
                <Skel className="h-[14px] w-28" />
                <Skel className="h-[14px] w-24" />
                <Skel className="ml-auto h-[14px] w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

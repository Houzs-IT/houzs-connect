import { PageSkeleton, Skel } from "@/components/skeleton";
import { CREATABLE_TRIGGERS } from "./copy";

/** One automation row placeholder — same box model as the real `AutomationCard`. */
function AutomationCardSkeleton({ i }: { i: number }) {
  return (
    <div
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="flex items-start gap-3 p-4">
        <Skel className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Skel className="h-[17px] w-52" />
            <Skel className="h-[19px] w-12 rounded-full" />
          </div>
          <Skel className="mt-1.5 h-[14px] w-full max-w-[420px]" />
          <Skel className="mt-1 h-[14px] w-64" />
          <Skel className="mt-2 h-[25px] w-40 rounded-md" />
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
        <Skel className="mr-auto h-[13px] w-64" />
        <Skel className="h-[25px] w-[86px] rounded-md" />
        <Skel className="h-[25px] w-[62px] rounded-md" />
        <Skel className="h-[25px] w-[70px] rounded-md" />
        <Skel className="h-[27px] w-[80px] rounded-lg" />
        <Skel className="h-[25px] w-[52px] rounded-md" />
      </div>
    </div>
  );
}

/**
 * Automations loading state — the composer on the left renders for real (it is
 * a static server-action form with no data behind it), only the list shimmers.
 */
export default function AutomationsLoading() {
  return (
    <PageSkeleton
      title="Automations"
      subtitle="Follow-up flows — what happens on its own, without anyone typing"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card">
          <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">
            New automation
          </h3>
          <p className="mb-3 text-[11px] text-[var(--color-faint)]">
            It starts as a draft and is switched off. Nothing is sent until you
            publish it.
          </p>
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">Name</div>
          <Skel className="mb-3 h-[33px] w-full rounded-lg" />
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">
            When should it run?
          </div>
          <Skel className="mb-2 h-[33px] w-full rounded-lg" />
          <ul className="mb-3 flex flex-col gap-1">
            {CREATABLE_TRIGGERS.map((t) => (
              <li
                key={t.value}
                className="text-[10.5px] leading-snug text-[var(--color-faint)]"
              >
                <span className="text-[var(--color-muted)]">{t.label}</span> — {t.hint}
              </li>
            ))}
          </ul>
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">
            Action id (only for “The ERP sends an action”)
          </div>
          <Skel className="mb-3 h-[33px] w-full rounded-lg" />
          <div className="mb-1 text-[11px] text-[var(--color-muted)]">
            Note (optional)
          </div>
          <Skel className="mb-3 h-[58px] w-full rounded-lg" />
          <Skel className="h-[37px] w-full rounded-lg" />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Skel className="h-[14px] w-56" />
          <div className="skeleton-stagger flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <AutomationCardSkeleton key={i} i={i} />
            ))}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}

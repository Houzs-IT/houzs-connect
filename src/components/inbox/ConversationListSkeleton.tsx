import { Skel } from "@/components/skeleton";

const TABS = ["All", "Unread", "Open", "Closed", "Queue"];

/**
 * Placeholder for `ConversationList` while the inbox layout loads its
 * conversations. Same 336px rail, same search + filter header (both static, so
 * they render for real), same 9px avatar / three-line row geometry — the list
 * fills in underneath without moving anything.
 */
export function ConversationListSkeleton() {
  return (
    <div className="flex w-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:w-[336px]">
      <div className="border-b border-[var(--color-border)] p-3">
        <Skel className="skeleton-strong h-[37px] w-full rounded-lg" />
        <div className="mt-2.5 flex items-center gap-1">
          {TABS.map((t, i) => (
            <span
              key={t}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                i === 0
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="skeleton-stagger min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="flex gap-3 border-b border-[var(--color-border)] px-3.5 py-3"
            style={{ "--i": i } as React.CSSProperties}
          >
            <Skel className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <Skel className="h-[15px] w-28" />
                <Skel className="h-[12px] w-10 shrink-0" />
              </div>
              <Skel className="mt-1 h-[14px] w-full" />
              <div className="mt-1.5 flex items-center gap-1">
                <Skel className="h-[16px] w-14 rounded" />
                <Skel className="h-[16px] w-10 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

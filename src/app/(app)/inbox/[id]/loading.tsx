import { Skel } from "@/components/skeleton";

/** Alternating inbound/outbound bubble placeholders. */
const BUBBLES = [
  { out: false, w: "w-[62%]", h: "h-[44px]" },
  { out: true, w: "w-[48%]", h: "h-[38px]" },
  { out: false, w: "w-[40%]", h: "h-[38px]" },
  { out: true, w: "w-[68%]", h: "h-[58px]" },
  { out: false, w: "w-[54%]", h: "h-[38px]" },
  { out: true, w: "w-[44%]", h: "h-[38px]" },
];

/**
 * Conversation thread loading state — the centre column (chat header, bubbles,
 * composer) plus the 320px contact panel. Switching between two chats now
 * repaints this shape instantly instead of holding the previous thread on
 * screen while the server reads messages.
 */
export default function ConversationLoading() {
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
        {/* Chat header */}
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <Skel className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0">
            <Skel className="h-[16px] w-36" />
            <Skel className="mt-1 h-[12px] w-28" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Skel className="h-[27px] w-16 rounded-full" />
            <Skel className="h-[27px] w-28 rounded-full" />
          </div>
        </div>

        {/* Thread — same px-6 py-6 / gap-2.5 rhythm as the real bubble list. */}
        <div className="skeleton-stagger flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-6 py-6">
          {BUBBLES.map((b, i) => (
            <div
              key={i}
              className={`flex ${b.out ? "justify-end" : "justify-start"}`}
              style={{ "--i": i } as React.CSSProperties}
            >
              <Skel className={`${b.w} ${b.h} max-w-[62%] rounded-xl`} />
            </div>
          ))}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-4 pt-3">
          <div className="mb-2 flex items-center gap-4">
            <Skel className="h-[15px] w-16" />
            <Skel className="h-[15px] w-20" />
            <Skel className="h-[15px] w-14" />
          </div>
          <div className="flex items-end gap-2">
            <Skel className="skeleton-strong h-[36px] min-w-0 flex-1 rounded-lg" />
            <Skel className="h-9 w-9 shrink-0 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Contact / order panel */}
      <aside className="hidden w-[320px] shrink-0 overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:block">
        <div className="flex flex-col items-center gap-2 border-b border-[var(--color-border)] px-5 py-6">
          <Skel className="h-14 w-14 rounded-full" />
          <Skel className="h-[18px] w-36" />
          <Skel className="h-[14px] w-28" />
        </div>
        <div className="skeleton-stagger flex flex-col gap-3 px-5 py-4">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} style={{ "--i": i } as React.CSSProperties}>
              <Skel className="h-[11px] w-24" />
              <Skel className="mt-1.5 h-[31px] w-full rounded-lg" />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

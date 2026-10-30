"use client";

/** What the composer needs to draw "Replying to …" and send the quote. */
export type ReplyTarget = {
  conversationId: string;
  waMessageId: string;
  name: string;
  text: string;
};

/** The thread is a server component, so the click reaches the composer as a DOM event. */
export const REPLY_EVENT = "inbox:reply";

export function ReplyButton({ target, label, out }: { target: ReplyTarget; label: string; out: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => window.dispatchEvent(new CustomEvent<ReplyTarget>(REPLY_EVENT, { detail: target }))}
      className={`grid h-7 w-7 shrink-0 place-items-center self-center rounded-full text-[var(--color-faint)] transition-opacity hover:bg-[var(--color-surface-dim)] hover:text-[var(--color-ink)] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
        out ? "order-first" : ""
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </svg>
    </button>
  );
}

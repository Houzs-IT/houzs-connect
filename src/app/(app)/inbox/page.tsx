import { IconInbox } from "@/components/icons";

export default function InboxEmpty() {
  return (
    <div className="dot-grid flex flex-1 flex-col items-center justify-center bg-[var(--color-canvas)] text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--color-surface)] text-[var(--color-accent)] shadow-sm ring-1 ring-[var(--color-border)]">
        <IconInbox width={28} height={28} />
      </div>
      <p className="mt-4 text-[15px] font-medium text-[var(--color-ink)]">
        Select a conversation
      </p>
      <p className="mt-1 max-w-xs text-[13px] text-[var(--color-muted)]">
        Pick a chat from the list to reply, assign, tag, or view the customer&apos;s
        order details.
      </p>
    </div>
  );
}

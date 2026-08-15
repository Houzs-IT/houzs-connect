"use client";

// The overflow menu Seampify puts on every conversation.
//
// These three are deliberately not selects: they are one-shot decisions an
// agent makes and walks away from, and burying them in the Status / Assigned
// dropdowns meant "give this back to the queue" read as an edit to a field
// rather than as handing the conversation off.

import { useState } from "react";
import { IconDots } from "@/components/icons";
import {
  markConversationUnread,
  pushConversationToQueue,
  unassignConversation,
} from "@/app/(app)/inbox/actions";

const ITEMS: { label: string; run: (fd: FormData) => Promise<void> }[] = [
  { label: "Mark as Unread", run: markConversationUnread },
  { label: "Push to Queue", run: pushConversationToQueue },
  { label: "Unassign", run: unassignConversation },
];

export function ConversationMenu({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Conversation actions"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <IconDots width={15} height={15} />
      </button>

      {open && (
        <>
          {/* Click-anywhere-to-close, the same backdrop the composer's + menu uses. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
            {ITEMS.map((it) => (
              <form
                key={it.label}
                action={async (fd) => {
                  await it.run(fd);
                  setOpen(false);
                }}
              >
                <input type="hidden" name="conversationId" value={conversationId} />
                <button
                  type="submit"
                  className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {it.label}
                </button>
              </form>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

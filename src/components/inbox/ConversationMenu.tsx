"use client";

// The overflow menu Seampify puts on every conversation.
//
// These are deliberately not selects: they are one-shot decisions an agent
// makes and walks away from, and burying them in a dropdown meant "give this
// back to the queue" read as an edit to a field rather than as handing the
// conversation off. Resolve / Reopen live on the thread header.

import { useState } from "react";
import { IconDots } from "@/components/icons";
import { setConversationStatus } from "@/app/actions";
import {
  markConversationUnread,
  pushConversationToQueue,
  unassignConversation,
} from "@/app/(app)/inbox/actions";
import { useShell } from "@/components/shell/ShellProvider";

async function markPending(fd: FormData) {
  fd.set("status", "PENDING");
  await setConversationStatus(fd);
}

export function ConversationMenu({ conversationId }: { conversationId: string }) {
  const { t } = useShell();
  const s = t.service;
  const [open, setOpen] = useState(false);

  const items: { label: string; run: (fd: FormData) => Promise<void> }[] = [
    { label: s.markUnread, run: markConversationUnread },
    { label: s.markPending, run: markPending },
    { label: s.pushQueue, run: pushConversationToQueue },
    { label: s.unassign, run: unassignConversation },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={s.actions}
        title={s.actions}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      >
        <IconDots width={15} height={15} />
      </button>

      {open && (
        <>
          {/* Click-anywhere-to-close, the same backdrop the composer's panels use. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
            {items.map((it) => (
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
                  className="w-full px-3 py-2 text-left text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
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

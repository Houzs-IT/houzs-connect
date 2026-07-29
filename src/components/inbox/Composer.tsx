"use client";

import { useRef, useState } from "react";
import { sendMessage } from "@/app/actions";
import { IconPaperclip, IconSend } from "@/components/icons";

export function Composer({ conversationId }: { conversationId: string }) {
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const formRef = useRef<HTMLFormElement>(null);
  const note = kind === "note";

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-4 pt-3">
      <div className="mb-2 flex items-center gap-4 text-[12.5px] font-medium">
        <button
          onClick={() => setKind("reply")}
          className={`border-b-2 pb-1 transition-colors ${
            !note
              ? "border-[var(--color-accent)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-muted)]"
          }`}
        >
          Reply
        </button>
        <button
          onClick={() => setKind("note")}
          className={`border-b-2 pb-1 transition-colors ${
            note
              ? "border-[var(--color-accent)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-muted)]"
          }`}
        >
          Private note
        </button>
      </div>

      <form
        ref={formRef}
        action={async (fd) => {
          await sendMessage(fd);
          formRef.current?.reset();
        }}
        className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
          note
            ? "border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[var(--color-accent-soft)]/40"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
        }`}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="kind" value={kind} />
        <button
          type="button"
          className="pb-1 text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
        >
          <IconPaperclip width={18} height={18} />
        </button>
        <textarea
          name="body"
          rows={1}
          placeholder={
            note
              ? "Write an internal note (not sent to customer)…"
              : "Type a message · / for quick replies"
          }
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90"
          aria-label="Send"
        >
          <IconSend width={17} height={17} />
        </button>
      </form>
    </div>
  );
}

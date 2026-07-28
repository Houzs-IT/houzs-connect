"use client";

import { useRef } from "react";
import { demoCustomerText } from "@/app/actions";

/** DEMO helper: send a message *as the customer* to drive collect-input steps. */
export function DemoReplyBar({ conversationId }: { conversationId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <div className="shrink-0 border-t border-dashed border-[color-mix(in_srgb,var(--color-info)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_6%,transparent)] px-4 py-2">
      <form
        ref={ref}
        action={async (fd) => {
          await demoCustomerText(fd);
          ref.current?.reset();
        }}
        className="flex items-center gap-2"
      >
        <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--color-info)_14%,transparent)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--color-info)]">
          Demo · as customer
        </span>
        <input type="hidden" name="conversationId" value={conversationId} />
        <input
          name="text"
          placeholder="Type a reply as the customer to test the flow…"
          className="flex-1 bg-transparent text-[12.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <button
          type="submit"
          className="rounded-md border border-[color-mix(in_srgb,var(--color-info)_35%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-info)] hover:bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)]"
        >
          Send as customer
        </button>
      </form>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resendMessage } from "./actions";

/** "Send again" for a failed message; opens the new attempt once it is written. */
export function ResendButton({ id, label, busyLabel }: { id: string; label: string; busyLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await resendMessage(id);
            if (!res.ok) return setError(res.error ?? "Could not send.");
            router.push(`/logs?m=${res.id}`);
            router.refresh();
          })
        }
        className="flex h-[36px] items-center justify-center rounded-[8px] bg-[var(--color-accent)] text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-50"
      >
        ↻ {pending ? busyLabel : label}
      </button>
      {error && <p className="mt-1.5 text-[11.5px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

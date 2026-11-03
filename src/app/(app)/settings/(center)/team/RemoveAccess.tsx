"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { removeAccess } from "./actions";

/** "Remove": take a person out of Houzs Connect, after saying what that does. */
export function RemoveAccess({ email, name }: { email: string; name: string }) {
  const { t } = useShell();
  const L = t.set;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="h-[28px] rounded-[6px] px-2 text-[12px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
      >
        {L.removeAccess}
      </button>
      <ActionConfirm
        open={open}
        title={fmt(L.removeTitle, { name })}
        confirmLabel={L.removeConfirm}
        busy={busy}
        danger
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            const res = await removeAccess(email);
            if (!res.ok) return setError(res.error ?? "Could not remove access.");
            setOpen(false);
            router.refresh();
          })
        }
      >
        <p>{L.removeBody}</p>
        {error && <p className="mt-2 text-[var(--color-danger)]">{error}</p>}
      </ActionConfirm>
    </>
  );
}

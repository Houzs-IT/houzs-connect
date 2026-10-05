"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { cancelJoinRequest, joinChannel } from "./actions";

/**
 * What someone who is not in a channel sees instead of its messages: what the
 * channel is, and Join (open channels, and company admins), Request to join
 * (channels that need approval), or the request they already sent.
 */
export function JoinGate({
  id,
  name,
  topic,
  members,
  access,
  pending,
  direct,
}: {
  id: string;
  name: string;
  topic: string | null;
  members: number;
  access: "open" | "approval";
  /** I already asked to join. */
  pending: boolean;
  /** I can join without approval (open channel, or a company admin). */
  direct: boolean;
}) {
  const { t } = useShell();
  const L = t.internal;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not do that.");
      setError(null);
      router.refresh();
    });

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--color-surface)] p-6">
      <div className="w-full max-w-[420px] rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-card,0_1px_2px_rgba(17,23,34,0.06))]">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-[14px] bg-[var(--color-accent-soft)] text-[24px] font-semibold text-[var(--color-accent-ink)]">
          {access === "approval" ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          ) : (
            "#"
          )}
        </div>
        <h2 className="text-[17px] font-semibold text-[var(--color-ink)]"># {name}</h2>
        {topic && <p className="mt-1 text-[13px] text-[var(--color-muted)]">{topic}</p>}
        <p className="mt-2 text-[12px] text-[var(--color-faint)]">
          {fmt(L.members, { n: members })} · {access === "approval" ? L.accessApproval : L.accessOpen}
        </p>
        <p className="mx-auto mt-3 max-w-[320px] text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          {pending ? L.requestedNote : access === "approval" && !direct ? L.privateNote : L.openNote}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {pending ? (
            <>
              <span className="flex h-[36px] items-center rounded-[8px] bg-[var(--color-pastel-orange)] px-3.5 text-[13px] font-semibold text-[var(--color-warning)]">
                {L.requested}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => cancelJoinRequest(id))}
                className="h-[36px] rounded-[8px] border border-[var(--color-border)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {L.cancelRequest}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => joinChannel(id))}
              className="h-[36px] rounded-[8px] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-50"
            >
              {access === "approval" && !direct ? L.requestJoin : L.joinChannel}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-[12px] text-[var(--color-danger)]">{error}</p>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { cancelJoinRequest, joinChannel } from "../actions";
import type { BrowseChannel } from "../data";

/** Every channel in the company with what I can do about each: open, join, request, or cancel my request. */
export function BrowseList({ channels, companyAdmin }: { channels: BrowseChannel[]; companyAdmin: boolean }) {
  const { t } = useShell();
  const L = t.internal;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = channels.filter((c) => (c.name + " " + (c.topic ?? "")).toLowerCase().includes(q.trim().toLowerCase()));

  const run = (fn: () => Promise<{ ok: boolean; error?: string; state?: string }>, id: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not do that.");
      setError(null);
      if (res.state === "member") router.push(`/internal/${id}`);
      router.refresh();
    });

  const btn = "h-[32px] shrink-0 rounded-[8px] px-3 text-[12.5px] font-semibold disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={L.searchChannels}
        className="h-[36px] w-full max-w-[360px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
      />
      {error && <p className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {shown.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[var(--color-faint)]">{L.noChannels}</p>}
        {shown.map((c) => {
          const direct = c.access === "open" || companyAdmin;
          return (
            <div key={c.id} className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[16px] font-semibold text-[var(--color-ink)]">
                #
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{c.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                      c.access === "approval" ? "bg-[var(--color-pastel-orange)] text-[var(--color-warning)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                    }`}
                  >
                    {c.access === "approval" ? L.badgeApproval : L.badgeOpen}
                  </span>
                </div>
                <div className="truncate text-[12px] text-[var(--color-faint)]">
                  {fmt(L.members, { n: c.members })}
                  {c.topic ? ` · ${c.topic}` : ""}
                </div>
              </div>
              {c.mine === "member" ? (
                <Link href={`/internal/${c.id}`} className={`${btn} flex items-center border border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]`}>
                  {L.openChannel}
                </Link>
              ) : c.mine === "pending" ? (
                <button type="button" disabled={busy} onClick={() => run(() => cancelJoinRequest(c.id), c.id)} className={`${btn} border border-[var(--color-border)] text-[var(--color-muted)]`}>
                  {L.requested} · {L.cancelRequest}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(() => joinChannel(c.id), c.id)} className={`${btn} bg-[var(--color-accent)] text-white`}>
                  {direct ? L.joinChannel : L.requestJoin}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

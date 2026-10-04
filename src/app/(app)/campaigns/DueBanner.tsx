"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { prepareSavedSend, sendCampaignNow } from "./actions";
import type { SendPreview } from "./spec";

/**
 * Scheduled campaigns whose time has passed. Nothing sends them on a timer —
 * this Worker has no scheduled trigger — so they wait here and a person sends
 * them, through the same review and two-step confirm as a fresh broadcast.
 */
export function DueBanner({
  items,
}: {
  items: { id: string; name: string; when: string; waiting: boolean }[];
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.camp;
  const first = items[0];
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setArmed(false);
    setDone(null);
    setError(null);
    setPreview(null);
    setBusy(true);
    const res = await prepareSavedSend(first.id);
    setBusy(false);
    setPreview(res.preview ?? null);
    if (!res.ok) setError(res.error ?? "Could not prepare this send.");
  }

  async function send() {
    setBusy(true);
    setError(null);
    // Chunked send — loop until nothing remains so one request never runs the
    // Worker out of budget mid-broadcast.
    let res = await sendCampaignNow({ campaignId: first.id, confirm: "SEND" });
    while (res.ok && (res.remaining ?? 0) > 0) {
      res = await sendCampaignNow({ campaignId: first.id, confirm: "SEND" });
    }
    setBusy(false);
    setArmed(false);
    if (!res.ok) return setError(res.error ?? "The send failed.");
    setDone(fmt(L.sentDone, { sent: res.sent ?? 0, n: res.recipients ?? 0 }));
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-[12px] border border-[#ecd9a8] bg-[#fbf3df] px-4 py-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f6e6bd] text-[var(--color-pastel-orange-ink)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--color-ink)]">
          {fmt(items.length === 1 ? L.dueOne : L.dueMany, { n: items.length })}
        </div>
        <div className="text-[12px] text-[var(--color-warning)]">
          {fmt(L.dueBody, { name: first.name, when: first.when })}
        </div>
      </div>
      <Link
        href={`/campaigns/new?edit=${first.id}`}
        className="flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
      >
        {L.review}
      </Link>
      <button
        type="button"
        disabled={first.waiting}
        title={first.waiting ? L.waiting : undefined}
        onClick={() => void start()}
        className="flex h-[34px] items-center rounded-[8px] bg-[var(--color-accent)] px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40"
      >
        {L.sendNow}
      </button>

      <ActionDialog open={open} title={fmt(L.sendTitle, { name: first.name })} onClose={() => setOpen(false)}>
        {busy && !preview && <p className="text-[12.5px] text-[var(--color-faint)]">{L.checking}</p>}
        {preview && !done && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-[var(--color-ink)]">
              {fmt(L.willGet, {
                n: preview.recipients,
                from: preview.channelLabel,
                tpl: `${preview.templateName} (${preview.templateLang})`,
              })}
            </p>
            {preview.sampleMessage && (
              <p className="whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-out)] p-3 text-[12.5px] leading-relaxed text-[var(--color-ink)]">
                {preview.sampleMessage}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {L.back}
              </button>
              {!armed ? (
                <button
                  type="button"
                  disabled={preview.recipients === 0}
                  onClick={() => setArmed(true)}
                  className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {L.sendNow}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                  className="h-[34px] rounded-[8px] bg-[var(--color-danger)] px-3 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {busy ? L.sendingNow : fmt(L.confirmSend, { n: preview.recipients })}
                </button>
              )}
            </div>
          </div>
        )}
        {done && <p className="text-[13px] text-[var(--color-success)]">{done}</p>}
        {error && <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>}
      </ActionDialog>
    </div>
  );
}

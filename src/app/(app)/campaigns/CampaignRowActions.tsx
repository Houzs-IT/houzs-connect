"use client";

// Row actions for the campaign history, and the manual dispatcher for a
// scheduled campaign that has come due.
//
// Delete follows the Contacts page's two-step: the button becomes "Sure?" and
// only the second click submits. Sending a due campaign is deliberately heavier
// — it goes through the same review and the same armed confirm as a fresh
// broadcast, because it is the same act.

import { useState } from "react";
import Link from "next/link";
import {
  deleteCampaign,
  duplicateCampaign,
  prepareSavedSend,
  sendCampaignNow,
  unscheduleCampaign,
} from "./actions";
import type { SendPreview } from "./spec";

const linkCls =
  "whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]";

export function CampaignRowActions({
  id,
  name,
  editable,
  scheduled,
}: {
  id: string;
  name: string;
  /** Draft or scheduled — a sent campaign can only be duplicated or deleted. */
  editable: boolean;
  scheduled: boolean;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div className="flex items-center justify-end gap-0.5">
      {editable && (
        <Link href={`/campaigns?edit=${id}`} className={linkCls}>
          Edit
        </Link>
      )}

      <form action={duplicateCampaign}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className={linkCls}>
          Duplicate
        </button>
      </form>

      {scheduled && (
        <form action={unscheduleCampaign}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={linkCls}>
            Unschedule
          </button>
        </form>
      )}

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          title={`Delete ${name}`}
          className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] hover:text-[var(--color-danger)]"
        >
          Delete
        </button>
      ) : (
        <span className="flex items-center gap-1">
          <form action={deleteCampaign}>
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="whitespace-nowrap rounded-md bg-[var(--color-danger)] px-2 py-1 text-[11px] font-semibold text-white"
            >
              Sure?
            </button>
          </form>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * Send a scheduled campaign whose time has passed.
 *
 * There is no background dispatcher: this Worker has no cron trigger, and
 * adding one means touching wrangler.toml and an API route, neither of which
 * this change owns. Rather than let "Scheduled" quietly mean "never sent", a due
 * campaign surfaces here and a human finishes it — through the same review and
 * confirm as any other broadcast.
 */
export function DueSendButton({ id, name }: { id: string; name: string }) {
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function review() {
    setBusy(true);
    setError(null);
    const res = await prepareSavedSend(id);
    setBusy(false);
    setPreview(res.preview ?? null);
    if (!res.ok) setError(res.error ?? "Could not prepare this send.");
  }

  async function send() {
    setBusy(true);
    setError(null);
    const res = await sendCampaignNow({ campaignId: id, confirm: "SEND" });
    setBusy(false);
    setArmed(false);
    if (!res.ok) return setError(res.error ?? "The send failed.");
    setPreview(null);
    setDone(`Sent to ${res.sent} of ${res.recipients} recipients.`);
  }

  if (done) {
    return <p className="text-[12px] text-[var(--color-success)]">{done}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-[var(--color-ink)]">
          <span className="font-medium">{name}</span> was scheduled and is now due.
        </span>
        {!preview && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void review()}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            {busy ? "Checking…" : "Review it"}
          </button>
        )}
      </div>

      {preview && (
        <div className="rounded-lg bg-[var(--color-surface)] p-2.5">
          <p className="text-[12px] text-[var(--color-ink)]">
            <span className="font-mono font-semibold">{preview.recipients}</span> will receive it
            from {preview.channelLabel}, using{" "}
            <span className="font-code">{preview.templateName}</span>.
          </p>
          {preview.sampleMessage && (
            <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-[var(--color-out)] p-2 text-[12px] leading-relaxed text-[var(--color-ink)]">
              {preview.sampleMessage}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!armed ? (
              <button
                type="button"
                onClick={() => setArmed(true)}
                className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1 text-[12px] font-medium text-white"
              >
                Send it now
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send()}
                  className="rounded-lg bg-[var(--color-danger)] px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "Sending…" : `Yes — message ${preview.recipients} now`}
                </button>
                <button
                  type="button"
                  onClick={() => setArmed(false)}
                  className="text-[12px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-[11.5px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

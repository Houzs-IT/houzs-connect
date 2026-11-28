"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { sendCampaignNow } from "./actions";

/**
 * Finish a campaign left "sending" (audit 2026-11-28, X3): the tab that drove
 * it closed, or a cron tick hit its chunk cap. Two clicks, then the same chunk
 * loop as Send now. Only people not yet sent to get it (send.ts stats.doneIds),
 * and if another send holds the campaign (send.ts lease) it says so and stops.
 */
export function ResumeButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.camp;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setMsg(null);
    let res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    while (res.ok && (res.remaining ?? 0) > 0) {
      res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    }
    setBusy(false);
    setArmed(false);
    if (!res.ok) setMsg(res.error ?? "The send failed.");
    else setMsg(fmt(L.sentDone, { sent: res.sent ?? 0, n: res.recipients ?? 0 }));
    router.refresh();
  }

  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      {!armed ? (
        <button
          type="button"
          title={L.resumeTitle}
          onClick={() => setArmed(true)}
          className="rounded-[6px] border border-[var(--color-border)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-surface-2)]"
        >
          {L.resume}
        </button>
      ) : (
        <span className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void resume()}
            className="rounded-[6px] bg-[var(--color-accent)] px-2 py-0.5 text-[11.5px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? L.sending : L.resumeSure}
          </button>
          {!busy && (
            <button type="button" onClick={() => setArmed(false)} className="px-1 text-[11.5px] text-[var(--color-muted)]">
              {L.back}
            </button>
          )}
        </span>
      )}
      {msg && <span className="max-w-[220px] text-[11px] text-[var(--color-muted)]">{msg}</span>}
    </div>
  );
}

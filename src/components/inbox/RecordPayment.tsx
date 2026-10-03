"use client";

import { useState } from "react";
import { recordErpPayment } from "@/app/(app)/inbox/erp-actions";
import { fmt } from "@/lib/i18n/dict";
import { useShell } from "@/components/shell/ShellProvider";
import type { PickOption } from "@/lib/erp/orders";

const FIELD =
  "h-[30px] w-full min-w-0 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";

/** "Record payment" on one ERP order: a small form that posts to the ERP. */
export function RecordPayment({
  conversationId,
  docNo,
  today,
  oldest,
  onlineTypes,
  merchants,
  preview,
}: {
  conversationId: string;
  docNo: string;
  /** YYYY-MM-DD, Malaysian time — the newest allowed slip date. */
  today: string;
  /** The oldest allowed slip date (14 days back). */
  oldest: string;
  onlineTypes: PickOption[];
  merchants: PickOption[];
  preview: boolean;
}) {
  const { t } = useShell();
  const s = t.service;
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"transfer" | "cash" | "merchant">("transfer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
          className="text-[11.5px] font-semibold text-[var(--color-accent)] hover:underline"
        >
          + {s.record}
        </button>
        {msg && (
          <span className={`text-[11px] ${msg.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {msg.text}
          </span>
        )}
      </div>
    );
  }

  const subs = method === "transfer" ? onlineTypes : method === "merchant" ? merchants : [];

  return (
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5"
      action={async (fd) => {
        setBusy(true);
        setMsg(null);
        const res = await recordErpPayment(fd);
        setBusy(false);
        if (res.ok) {
          setOpen(false);
          setMsg({ ok: true, text: s.recorded });
        } else {
          setMsg({ ok: false, text: fmt(s.recordFailed, { e: res.error === "preview" ? s.previewNoWrite : res.error }) });
        }
      }}
    >
      <div className="text-[11.5px] font-semibold text-[var(--color-ink)]">{s.recordTitle}</div>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="docNo" value={docNo} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
          {s.amount}
          <input name="amount" inputMode="decimal" required pattern="[0-9,]+(\.[0-9]{1,2})?" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
          {s.paidOn}
          <input name="paidAt" type="date" required defaultValue={today} min={oldest} max={today} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
          {s.method}
          <select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className={FIELD}
          >
            {(["transfer", "cash", "merchant"] as const).map((m) => (
              <option key={m} value={m}>
                {s.methods[m]}
              </option>
            ))}
          </select>
        </label>
        {subs.length > 0 ? (
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {method === "transfer" ? s.onlineType : s.bank}
            <select name="sub" required defaultValue="" className={FIELD} key={method}>
              <option value="" disabled>
                —
              </option>
              {subs.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : method !== "cash" ? (
          <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
            {method === "transfer" ? s.onlineType : s.bank}
            <input name="sub" required className={FIELD} key={method} />
          </label>
        ) : (
          <span />
        )}
      </div>
      <label className="flex flex-col gap-1 text-[11px] text-[var(--color-muted)]">
        {s.reference}
        <input name="reference" maxLength={80} className={FIELD} />
      </label>
      <p className="text-[10.5px] text-[var(--color-faint)]">{preview ? s.previewNoWrite : s.windowHint}</p>
      {msg && !msg.ok && <p className="text-[11px] text-[var(--color-danger)]">{msg.text}</p>}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-[30px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12px] font-semibold text-[var(--color-ink)]"
        >
          {s.cancel}
        </button>
        <button
          type="submit"
          disabled={busy || preview}
          className="h-[30px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? s.sending : s.save}
        </button>
      </div>
    </form>
  );
}

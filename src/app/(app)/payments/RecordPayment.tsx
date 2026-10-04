"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { formatPhone } from "@/lib/format";
import { findPaymentContacts, recordPayment } from "./actions";

type Found = { id: string; name: string | null; phone: string };

const input =
  "h-[38px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const label = "mb-1 block text-[12px] font-semibold text-[var(--color-ink)]";

/** "+ Record payment": a payment seen outside the chat, saved in Connect only. */
export function RecordPayment() {
  const router = useRouter();
  const { t } = useShell();
  const L = t.pay;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; rows: Found[] } | null>(null);
  const [who, setWho] = useState<Found | null>(null);
  const [f, setF] = useState({ amount: "", method: "", referenceNo: "", orderRef: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Search as the name or number is typed, a moment after the last key.
  useEffect(() => {
    if (who || q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void findPaymentContacts(q).then((rows) => {
        if (!cancelled) setFound({ q, rows });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, who]);
  const rows = found?.q === q ? found.rows : [];

  const reset = () => {
    setQ("");
    setWho(null);
    setF({ amount: "", method: "", referenceNo: "", orderRef: "" });
    setConfirmed(false);
    setError(null);
  };

  const save = () =>
    start(async () => {
      if (!who) return setError("Choose the customer first.");
      const res = await recordPayment({ contactId: who.id, ...f, confirmed });
      if (!res.ok) return setError(res.error ?? "Could not save.");
      setOpen(false);
      reset();
      router.push(`/payments?status=all&p=${res.id}`);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
      >
        <span className="text-[16px] leading-none">+</span>
        {L.record}
      </button>
      <ActionDialog open={open} title={L.record} subtitle={L.recordSub} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <span className={label}>{L.customer}</span>
            {who ? (
              <div className="flex h-[38px] items-center justify-between rounded-[8px] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 text-[13px]">
                <span className="truncate font-semibold text-[var(--color-ink)]">
                  {who.name ?? formatPhone(who.phone)} <span className="font-normal text-[var(--color-faint)]">{formatPhone(who.phone)}</span>
                </span>
                <button type="button" onClick={() => setWho(null)} className="text-[16px] text-[var(--color-faint)]" aria-label="Clear">
                  ×
                </button>
              </div>
            ) : (
              <div className="relative">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.findCustomer} className={input} />
                {rows.length > 0 && (
                  <div className="absolute inset-x-0 z-10 mt-1 overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
                    {rows.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setWho(r)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                      >
                        <span className="truncate text-[var(--color-ink)]">{r.name ?? "—"}</span>
                        <span className="text-[12px] tabular-nums text-[var(--color-faint)]">{formatPhone(r.phone)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["amount", L.amount, "600.00"],
                ["method", L.paidBy, "Maybank"],
                ["referenceNo", L.reference, "M2610028831"],
                ["orderRef", L.order, "znt6012"],
              ] as [keyof typeof f, string, string][]
            ).map(([k, l, ph]) => (
              <div key={k}>
                <span className={label}>{l}</span>
                <input
                  value={f[k]}
                  inputMode={k === "amount" ? "decimal" : undefined}
                  placeholder={ph}
                  onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
                  className={input}
                />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            {L.markConfirmed}
          </label>
          {error && <p className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-[36px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              {L.cancel}
            </button>
            <button
              type="button"
              disabled={pending || !who || !f.amount.trim()}
              onClick={save}
              className="h-[36px] rounded-[8px] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {pending ? L.saving : L.record}
            </button>
          </div>
        </div>
      </ActionDialog>
    </>
  );
}

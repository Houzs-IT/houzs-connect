"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { displayName, formatPhone, initials, tint } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { reviewPayment, updatePaymentFields } from "./actions";
import { money } from "./util";

export interface ReviewPayment {
  id: string;
  name: string | null;
  phone: string;
  amount: number | null;
  currency: string;
  method: string | null;
  referenceNo: string | null;
  orderRef: string | null;
  status: string;
  ocrRawText: string | null;
  /** The customer's slip is on Meta and can be shown through /payments/[id]/receipt. */
  hasImage: boolean;
  conversationId: string | null;
  /** "10:12" / "Yesterday" / "29 Sep" */
  when: string;
  /** "02/10/2026, 10:12" */
  date: string;
}

/**
 * One receipt being checked: what was read off it (each field correctable while
 * it is still to check — a field OCR could not read is marked), and the
 * decision. Confirm / reject moves on to the next receipt in the queue.
 */
export function PaymentReview({
  p,
  dupWith,
  nextHref,
  backHref,
}: {
  p: ReviewPayment;
  dupWith: string | null;
  nextHref: string;
  backHref: string;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.pay;
  const open = p.status === "PENDING";
  const [f, setF] = useState({
    amount: p.amount != null ? p.amount.toFixed(2) : "",
    referenceNo: p.referenceNo ?? "",
    method: p.method ?? "",
    orderRef: p.orderRef ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [turn, setTurn] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const who = displayName(p.name, p.phone);
  const c = tint(p.phone);

  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setDirty(true);
    setMsg(null);
  };
  const save = () =>
    start(async () => {
      const res = await updatePaymentFields(p.id, f);
      setMsg(res.ok ? { ok: true, text: L.saved } : { ok: false, text: res.error ?? "Could not save." });
      if (res.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  const decide = (status: "VERIFIED" | "REJECTED" | "PENDING") =>
    start(async () => {
      if (dirty && open) {
        const res = await updatePaymentFields(p.id, f);
        if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save." });
      }
      await reviewPayment(p.id, status);
      router.push(status === "PENDING" ? backHref : nextHref);
      router.refresh();
    });

  const rows: [keyof typeof f, string, string, string][] = [
    ["amount", L.amount, "RM", "green"],
    ["referenceNo", L.reference, "#", "orange"],
    ["method", t.pay.paidBy, "⌂", "blue"],
    ["orderRef", L.order, "▤", "purple"],
  ];
  const badge =
    p.status === "PENDING"
      ? ["bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]", L.toCheck]
      : p.status === "VERIFIED"
        ? ["bg-[var(--color-success-soft)] text-[var(--color-success)]", L.confirmed]
        : ["bg-[var(--color-danger-soft)] text-[var(--color-danger)]", L.rejected];
  const unread = rows.some(([k]) => !f[k].trim());

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <Link href={backHref} aria-label={L.back} className="grid h-8 w-8 place-items-center rounded-[8px] text-[var(--color-muted)] lg:hidden">
          ‹
        </Link>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold"
          style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
        >
          {initials(who)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{who}</span>
            <span className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${badge[0]}`}>{badge[1]}</span>
          </div>
          <div className="truncate text-[12px] text-[var(--color-faint)]">
            {formatPhone(p.phone)} · {fmt(L.sentInChat, { when: p.when })}
          </div>
        </div>
        {p.conversationId && (
          <Link
            href={`/inbox/${p.conversationId}`}
            className="hidden h-[34px] items-center rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] sm:flex"
          >
            {L.openConvo}
          </Link>
        )}
      </div>

      <div className="scroll-thin grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto p-4 xl:grid-cols-2">
        <div className="flex flex-col">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.receipt}</div>
          {p.hasImage && !imgFailed ? (
            <>
              <div className="grid min-h-[320px] flex-1 place-items-center overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/payments/${p.id}/receipt`}
                  alt={L.receipt}
                  onError={() => setImgFailed(true)}
                  className="max-h-[440px] max-w-full rounded-[8px] object-contain shadow-[0_8px_24px_-8px_rgba(17,23,34,0.25)] transition-transform"
                  style={{ transform: `rotate(${turn}deg)` }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                {[
                  [L.zoom, () => window.open(`/payments/${p.id}/receipt`, "_blank", "noopener")],
                  [L.rotate, () => setTurn((d) => (d + 90) % 360)],
                ].map(([l, fn]) => (
                  <button
                    key={l as string}
                    type="button"
                    onClick={fn as () => void}
                    className="h-[32px] rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  >
                    {l as string}
                  </button>
                ))}
                <a
                  href={`/payments/${p.id}/receipt`}
                  download
                  className="flex h-[32px] items-center rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                  {L.download}
                </a>
              </div>
            </>
          ) : (
          <div className="grid flex-1 place-items-center rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
              <div className="w-full max-w-[260px] -rotate-2 rounded-[10px] bg-white p-4 shadow-[0_8px_24px_-8px_rgba(17,23,34,0.25)]">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[var(--color-pastel-orange)] text-[9px] font-bold text-[var(--color-pastel-orange-ink)]">
                    {(f.method || "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{f.method || L.unknown}</span>
                </div>
                <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.transfer}</div>
                <div className="mt-1.5 text-[22px] font-semibold text-[var(--color-ink)]">{f.amount ? money(Number(f.amount) || 0, p.currency) : "—"}</div>
                <dl className="mt-3 space-y-1.5 border-t border-dashed border-[var(--color-border)] pt-3 text-[11px]">
                  {[
                    [L.reference, f.referenceNo || "—", true],
                    [L.date, p.date, false],
                    [L.note, f.orderRef || "—", true],
                  ].map(([k, v, chip]) => (
                    <div key={k as string} className="flex items-center justify-between gap-2">
                      <dt className="text-[var(--color-faint)]">{k}</dt>
                      <dd className={`text-right text-[var(--color-ink)] ${chip ? "rounded-[3px] bg-[var(--color-brand-soft)] px-1" : ""}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
          {(!p.hasImage || imgFailed) && <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{L.receiptNote}</p>}
          {p.ocrRawText && (
            <details className="mt-2 text-[12px] text-[var(--color-muted)]">
              <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-ink)]">{L.ocrText}</summary>
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-[8px] bg-[var(--color-surface-2)] p-2.5 font-sans text-[12px]">{p.ocrRawText}</pre>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.readFrom}</span>
            <span className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${unread ? "text-[var(--color-pastel-orange-ink)]" : "text-[var(--color-success)]"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${unread ? "bg-[var(--color-pastel-orange-ink)]" : "bg-[var(--color-success)]"}`} />
              {unread ? L.checkIt : L.autoRead}
            </span>
          </div>
          {rows.map(([k, label, icon, tone]) => {
            const missing = !f[k].trim();
            return (
              <label key={k} className="flex items-center gap-3">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                  style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                >
                  {icon}
                </span>
                <span className="w-[86px] shrink-0 text-[12.5px] text-[var(--color-muted)]">{label}</span>
                <span className="relative flex min-w-0 flex-1">
                {k === "amount" && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--color-ink)]">RM</span>
                )}
                <input
                  value={f[k]}
                  disabled={!open}
                  inputMode={k === "amount" ? "decimal" : undefined}
                  onChange={(e) => set(k, e.target.value)}
                  className={`h-[36px] min-w-0 flex-1 rounded-[8px] border ${k === "amount" ? "pl-10 pr-3" : "px-3"} text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:bg-[var(--color-surface-2)] ${
                    missing && open ? "border-[var(--color-pastel-orange-ink)] bg-[var(--color-pastel-orange)]" : "border-[var(--color-border)]"
                  }`}
                />
                </span>
              </label>
            );
          })}
          {dirty && open && (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="self-end rounded-[8px] border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            >
              {L.save}
            </button>
          )}
          {msg && <p className={`text-[12px] ${msg.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p>}
          {dupWith && (
            <p className="rounded-[10px] bg-[var(--color-pastel-orange)] px-3 py-2.5 text-[12px] text-[var(--color-warning)]">
              {fmt(L.dupWarn, { ref: f.referenceNo, who: dupWith })}
            </p>
          )}

          <div className="rounded-[12px] border border-[var(--color-border)] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{L.erpOrder}</span>
              {f.orderRef && <b className="text-[13px] font-semibold text-[var(--color-brand)]">{f.orderRef}</b>}
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-faint)]">{L.erpOff}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
        <p className="hidden min-w-0 flex-1 text-[12px] text-[var(--color-faint)] md:block">{L.footer}</p>
        {open ? (
          <div className="flex w-full gap-2 md:w-auto">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide("REJECTED")}
              className="h-[44px] flex-1 rounded-[10px] bg-[var(--color-danger-soft)] px-4 text-[13.5px] font-semibold text-[var(--color-danger)] disabled:opacity-40 md:h-[38px] md:flex-none"
            >
              {L.reject}
            </button>
            <button
              type="button"
              disabled={pending || !f.amount.trim()}
              onClick={() => decide("VERIFIED")}
              className="h-[44px] flex-[2] rounded-[10px] bg-[var(--color-accent)] px-4 text-[13.5px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 md:h-[38px] md:flex-none"
            >
              ✓ {L.confirm}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("PENDING")}
            className="h-[38px] rounded-[10px] border border-[var(--color-border)] px-4 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            {L.reopen}
          </button>
        )}
      </div>
    </div>
  );
}

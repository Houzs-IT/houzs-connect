"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { IconClose, IconSearch } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { formatPhone, initials, tint } from "@/lib/format";

export interface CampaignMsg {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  status: string;
  body: string | null;
  at: string;
  replied: boolean;
}

type Filter = "all" | "sent" | "delivered" | "read" | "failed" | "replied";
const FILTERS: Filter[] = ["all", "sent", "delivered", "read", "failed", "replied"];
const PAGE_SIZES = [10, 25, 50];
const TZ = "Asia/Kuala_Lumpur";

function matches(m: CampaignMsg, f: Filter): boolean {
  switch (f) {
    case "sent":
      return m.status === "SENT" || m.status === "DELIVERED" || m.status === "READ";
    case "delivered":
      return m.status === "DELIVERED";
    case "read":
      return m.status === "READ";
    case "failed":
      return m.status === "FAILED";
    case "replied":
      return m.replied;
    default:
      return true;
  }
}

/** The campaign's messages: filter chips, search, a paged table and a detail modal. */
export function MessagesTab({
  rows,
  channelName,
  legacy,
}: {
  rows: CampaignMsg[];
  channelName: string;
  /** Sent before messages were linked to their campaign — nothing to list. */
  legacy: boolean;
}) {
  const { t } = useShell();
  const L = t.camp;
  const params = useSearchParams();
  const initialF = params.get("f") as Filter | null;
  const [filter, setFilter] = useState<Filter>(initialF && FILTERS.includes(initialF) ? initialF : "all");
  const [q, setQ] = useState("");
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<CampaignMsg | null>(null);

  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = rows.filter(
    (m) =>
      matches(m, filter) &&
      (!needle || (m.name ?? "").toLowerCase().includes(needle) || (digits && m.phone.includes(digits)))
  );
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * size, cur * size + size);

  const label: Record<Filter, string> = {
    all: L.allL,
    sent: L.stSent,
    delivered: L.stDelivered,
    read: L.stRead,
    failed: L.stFailed,
    replied: L.repliedF,
  };
  const count = (f: Filter) => rows.filter((m) => matches(m, f)).length;

  if (legacy) {
    return (
      <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center text-[13px] text-[var(--color-faint)]">
        {L.noPerMessage}
      </p>
    );
  }

  const cols = "grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_64px]";

  return (
    <div className="flex min-h-full flex-col rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex h-[36px] w-full max-w-[280px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 focus-within:border-[var(--color-accent)]">
          <IconSearch width={14} height={14} className="text-[var(--color-faint)]" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder={L.searchMsg}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setPage(0);
              }}
              className={`flex h-[32px] items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px] font-semibold ${
                filter === f
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {label[f]}
              <span className="text-[11px] font-normal text-[var(--color-faint)]">{count(f)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`grid ${cols} gap-3 border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]`}>
            <span>{L.customer}</span>
            <span>{L.phone}</span>
            <span>{L.sendStatus}</span>
            <span>{L.readStatusCol}</span>
            <span>{L.time}</span>
            <span />
          </div>
          {slice.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">{L.noMessages}</p>}
          {slice.map((m) => {
            const who = m.name || formatPhone(m.phone);
            const c = tint(m.phone);
            return (
              <div key={m.id} className={`grid ${cols} items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 hover:bg-[var(--color-surface-2)]`}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                    style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                  >
                    {initials(who)}
                  </span>
                  <span className="truncate text-[13px] font-medium uppercase text-[var(--color-ink)]">{who}</span>
                </span>
                <span className="text-[12.5px] tabular-nums text-[var(--color-muted)]">{formatPhone(m.phone)}</span>
                <SendStatus status={m.status} L={L} />
                <ReadStatus status={m.status} replied={m.replied} L={L} />
                <span className="text-[12.5px] text-[var(--color-muted)]">
                  {new Date(m.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ })}
                </span>
                <span className="flex items-center justify-end gap-3 text-[var(--color-accent)]">
                  <button type="button" aria-label={L.msgDetails} onClick={() => setOpen(m)}>
                    <Eye />
                  </button>
                  <Link href={`/inbox/${m.conversationId}`} aria-label={L.openConvo}>
                    <Chat />
                  </Link>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 px-4 py-3 text-[12px] text-[var(--color-muted)]">
        {L.show}
        <select
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            setPage(0);
          }}
          className="h-[30px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12.5px] text-[var(--color-ink)]"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <PageBtn disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ←
          </PageBtn>
          {pageList(cur, pages).map((p, i) =>
            p < 0 ? (
              <span key={`gap-${i}`} className="px-1 text-[var(--color-faint)]">
                …
              </span>
            ) : (
              <PageBtn key={p} on={p === cur} onClick={() => setPage(p)}>
                {p + 1}
              </PageBtn>
            )
          )}
          <PageBtn disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            →
          </PageBtn>
        </div>
      </div>

      {open && <Detail m={open} channelName={channelName} L={L} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 0-based page numbers with -1 for an ellipsis: 1 2 … 13. */
function pageList(cur: number, pages: number): number[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i);
  const set = new Set([0, 1, cur, pages - 1].filter((p) => p >= 0 && p < pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push(-1);
    out.push(p);
  });
  return out;
}

function PageBtn({ on, disabled, onClick, children }: { on?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`grid h-[30px] min-w-[30px] place-items-center rounded-[8px] px-1.5 text-[12.5px] font-semibold disabled:opacity-40 ${
        on ? "bg-[var(--color-accent)] text-white" : "border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {children}
    </button>
  );
}

type L = ReturnType<typeof useShell>["t"]["camp"];

function SendStatus({ status, L }: { status: string; L: L }) {
  const failed = status === "FAILED";
  const queued = status === "QUEUED";
  return (
    <span className={`text-[12.5px] ${failed ? "text-[var(--color-danger)]" : queued ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"}`}>
      {failed ? L.stFailed : queued ? L.stQueued : L.stSent}
    </span>
  );
}

function ReadStatus({ status, replied, L }: { status: string; replied: boolean; L: L }) {
  if (status === "FAILED" || status === "QUEUED") return <span className="text-[12.5px] text-[var(--color-faint)]">—</span>;
  const read = status === "READ";
  const delivered = status === "DELIVERED" || read;
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-muted)]">
      <Ticks double={delivered} blue={read} />
      {read ? L.stRead : delivered ? L.stDelivered : L.stSent}
      {replied && (
        <span className="rounded-full bg-[var(--color-pastel-purple)] px-1.5 text-[10.5px] font-semibold text-[var(--color-pastel-purple-ink)]">
          {L.repliedF}
        </span>
      )}
    </span>
  );
}

function Ticks({ double, blue }: { double: boolean; blue: boolean }) {
  return (
    <svg width="16" height="12" viewBox="0 0 24 16" fill="none" stroke={blue ? "#2f5bd8" : "#737c8c"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 9l4 4L14 3" />
      {double && <path d="M9 12l1 1L19 3" />}
    </svg>
  );
}

function Eye() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Chat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function Detail({ m, channelName, L, onClose }: { m: CampaignMsg; channelName: string; L: L; onClose: () => void }) {
  const at = new Date(m.at);
  const read = m.status === "READ";
  const delivered = m.status === "DELIVERED" || read;
  const rows: [string, string, string, string, React.ReactNode][] = [
    [L.sendStatus, m.status === "FAILED" ? L.stFailed : m.status === "QUEUED" ? L.stQueued : L.stSent, "green", "", m.status === "FAILED" ? "!" : "✓"],
    [L.readStatusCol, read ? L.stRead : delivered ? L.stDelivered : "—", "blue", "", <Ticks key="t" double={delivered} blue={read} />],
    [L.channel, channelName || "—", "pink", "", "✉"],
    [L.direction, L.outgoing, "purple", "", "↗"],
    [L.date, at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ }), "orange", "", "▦"],
    [L.time, at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ }), "cyan", "", "◷"],
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(17,23,34,0.32)] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[820px] flex-col overflow-hidden rounded-[16px] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4"
          style={{
            background:
              "linear-gradient(180deg,#f3effc,#ffffff), repeating-linear-gradient(0deg,transparent 0 15px,rgba(122,79,214,0.06) 15px 16px)",
            backgroundBlendMode: "multiply",
          }}
        >
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">{L.msgDetails}</h2>
            <p className="mt-0.5 text-[11.5px] uppercase text-[var(--color-faint)]">
              {m.name ?? ""} · {m.phone}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <IconClose width={14} height={14} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div className="grid gap-5 rounded-[12px] border border-[var(--color-border)] p-5 md:grid-cols-[240px_1fr]">
            <dl className="flex flex-col gap-4">
              {rows.map(([k, v, tone, , icon]) => (
                <div key={k} className="flex items-center gap-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px]"
                    style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                  >
                    {icon}
                  </span>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{k}</dt>
                    <dd className="text-[14px] font-semibold text-[var(--color-ink)]">{v}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <div>
              <div className="mb-3 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-pastel-pink)] text-[var(--color-pastel-pink-ink)]">
                  <Chat />
                </span>
                {L.message}
              </div>
              <div className="rounded-[12px] border border-[var(--color-border)] p-4">
                <div className="max-w-[340px] rounded-[10px] border border-[var(--color-border)] px-3 py-2.5 shadow-[0_1px_3px_rgba(17,23,34,0.08)]">
                  <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-[var(--color-ink)]">{m.body ?? "—"}</p>
                  <div className="mt-1.5 text-right text-[10.5px] text-[var(--color-faint)]">
                    {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Link
            href={`/inbox/${m.conversationId}`}
            className="flex h-[36px] items-center rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
          >
            {L.openConvo}
          </Link>
        </div>
      </div>
    </div>
  );
}

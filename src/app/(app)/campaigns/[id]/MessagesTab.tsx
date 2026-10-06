"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { DataCount, DataHead, DataMenus, DataSearch, useColumnLayout, useDataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { IconClose } from "@/components/icons";
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

/** Pending first, then sent, then failed, when sorting by send status. */
function sendRank(status: string): number {
  return status === "QUEUED" ? 0 : status === "FAILED" ? 2 : 1;
}

/** Sent < delivered < viewed, a reply above all; none while pending or failed. */
function readRank(m: CampaignMsg): number | null {
  if (m.status === "FAILED" || m.status === "QUEUED") return null;
  const level = m.status === "READ" ? 3 : m.status === "DELIVERED" ? 2 : 1;
  return m.replied ? level + 3 : level;
}

/**
 * The campaign's messages: filter chips (the KPI tiles link to them), then a
 * table to search, sort by any header and filter by each header's funnel, in
 * pages, with a detail modal per message.
 */
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
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<CampaignMsg | null>(null);

  const sendLabel = (status: string) => (status === "FAILED" ? L.stFailed : status === "QUEUED" ? L.stQueued : L.stSent);
  const readLabel = (status: string) =>
    status === "FAILED" || status === "QUEUED" ? null : status === "READ" ? L.stRead : status === "DELIVERED" ? L.stDelivered : L.stSent;
  const when = (at: string) =>
    new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).replace("Sept", "Sep");

  const columns: DataColumn[] = [
    { key: "customer", label: L.customer, filter: false },
    { key: "phone", label: L.phone, filter: false },
    { key: "send", label: L.sendStatus },
    { key: "read", label: L.readStatusCol },
    { key: "time", label: L.time, filter: false },
    { key: "actions", label: "", sort: false, filter: false, align: "right", className: "w-[80px]" },
  ];

  // The chip narrows the rows first; search and funnels work within it.
  const tableRows: DataRow[] = rows
    .filter((m) => matches(m, filter))
    .map((m) => {
      const who = m.name || formatPhone(m.phone);
      const c = tint(m.phone);
      const rl = readLabel(m.status);
      return {
        id: m.id,
        // The bare digits too, so "0123…" or "60123…" finds the number.
        search: m.phone,
        sort: {
          customer: who,
          phone: m.phone,
          send: sendRank(m.status),
          read: readRank(m),
          time: Date.parse(m.at),
        },
        text: {
          customer: who,
          phone: formatPhone(m.phone),
          send: sendLabel(m.status),
          read: rl && m.replied ? [rl, L.repliedF] : rl,
          time: when(m.at),
        },
        cells: {
          customer: (
            <span className="flex min-w-0 max-w-[280px] items-center gap-2.5">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
              >
                {initials(who)}
              </span>
              <span className="truncate text-[13px] font-medium uppercase text-[var(--color-ink)]">{who}</span>
            </span>
          ),
          phone: <span className="whitespace-nowrap text-[12.5px] tabular-nums text-[var(--color-muted)]">{formatPhone(m.phone)}</span>,
          send: <SendStatus status={m.status} L={L} />,
          read: <ReadStatus status={m.status} replied={m.replied} L={L} />,
          time: <span className="whitespace-nowrap text-[12.5px] text-[var(--color-muted)]">{when(m.at)}</span>,
          actions: (
            <span className="flex items-center justify-end gap-3 text-[var(--color-accent)]">
              <button type="button" aria-label={L.msgDetails} onClick={() => setOpen(m)}>
                <Eye />
              </button>
              <Link href={`/inbox/${m.conversationId}`} aria-label={L.openConvo}>
                <Chat />
              </Link>
            </span>
          ),
        },
      };
    });

  const table = useDataTable(tableRows, columns);
  const tableRef = useRef<HTMLTableElement>(null);
  const cw = useColumnLayout(tableRef, "campaign-messages", columns);
  const { shown } = table;

  // Back to the first page whenever the search, a funnel or the sort changes.
  const narrowing = JSON.stringify([table.q, table.filters, table.sort]);
  const [seen, setSeen] = useState(narrowing);
  if (seen !== narrowing) {
    setSeen(narrowing);
    setPage(0);
  }

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

  return (
    <div className="flex min-h-full flex-col rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <DataSearch table={table} placeholder={L.searchMsg} />
        <DataCount table={table} />
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
        <table ref={tableRef} style={cw.tableStyle} className={`w-full min-w-[820px] text-left text-[13px] ${cw.tableClass}`}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {cw.cols.map((c) => {
                const sorted = table.sort?.key === c.key ? table.sort.dir : null;
                const { frozenClass, ...head } = cw.headProps(c.key);
                return (
                  <th
                    key={c.key}
                    {...head}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={`group/th relative whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)] ${
                      cw.fixed ? "overflow-hidden" : ""
                    } ${c.className ?? ""} ${frozenClass}`}
                  >
                    <DataHead column={c} table={table} />
                    {cw.handle(c.key)}
                  </th>
                );
              })}
              {cw.fixed && <th aria-hidden className="p-0" />}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="group/row border-b border-[var(--color-border-subtle)] align-middle hover:bg-[var(--color-surface-2)]">
                {cw.cols.map((c) => {
                  const cell = cw.cellProps(c.key);
                  return (
                    <td
                      key={c.key}
                      style={cell.style}
                      className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""} ${cw.fixed ? "overflow-hidden break-words" : ""} ${c.className ?? ""} ${cell.className}`}
                    >
                      {r.cells[c.key]}
                    </td>
                  );
                })}
                {cw.fixed && <td className="p-0" />}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr>
                <td colSpan={cw.cols.length + (cw.fixed ? 1 : 0)} className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {L.noMessages}
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

      <DataMenus table={table} />
      {cw.menu}
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

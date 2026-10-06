"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { initials, tint } from "@/lib/format";
import { useShell } from "@/components/shell/ShellProvider";
import { IconClose, IconDots, IconSearch } from "@/components/icons";
import { ColumnsList, DataCount, DataHead, DataMenus, useColumnLayout, useDataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { bulkBlockContacts, bulkTagContacts, mergeContacts, setContactBlocked } from "./actions";
import { DeleteContactButton } from "./DeleteContactButton";

export type ContactRow = {
  id: string;
  name: string;
  phone: string;
  blocked: boolean;
  orderRef: string | null;
  orderSub: string | null;
  sales: string | null;
  tags: { id: string; name: string; color: string }[];
  last: { body: string; inbound: boolean } | null;
  updated: string;
  /** Last activity, for sorting. */
  updatedTs: number;
  email: string | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  company: string | null;
  remarks: string | null;
  created: string;
  createdTs: number;
};

export type DupPair = {
  a: { id: string; name: string | null; phone: string; source: string | null };
  b: { id: string; name: string | null; phone: string; source: string | null };
};

const OPTIONAL = ["email", "source", "sourceId", "sourceUrl", "company", "remarks", "created", "blocked"] as const;
type OptCol = (typeof OPTIONAL)[number];

// Extra columns are a per-browser preference (useSyncExternalStore: the server
// renders the default set, the browser switches on hydration).
const COLS_KEY = "hc_contacts_cols";
const colListeners = new Set<() => void>();
let colCache: { raw: string | null; cols: OptCol[] } = { raw: null, cols: [] };
function readCols(): OptCol[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLS_KEY);
  } catch {}
  if (raw === colCache.raw) return colCache.cols;
  let cols: OptCol[] = [];
  try {
    cols = (JSON.parse(raw ?? "[]") as string[]).filter((c): c is OptCol => (OPTIONAL as readonly string[]).includes(c));
  } catch {}
  colCache = { raw, cols };
  return cols;
}
const NO_COLS: OptCol[] = [];
function writeCols(cols: OptCol[]) {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  } catch {}
  colListeners.forEach((l) => l());
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

function Avatar({ name, blocked }: { name: string; blocked?: boolean }) {
  return (
    <span
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: blocked ? "#737c8c" : tint(name) }}
    >
      {/^\+?\d/.test(name) ? name.replace(/\D/g, "").slice(0, 2) : initials(name).toUpperCase()}
    </span>
  );
}

/** A pill dropdown in the filter row; accent when a value is chosen. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
  anyLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  anyLabel: string;
}) {
  const on = !!value;
  const shown = on ? `${label}: ${options.find((o) => o.value === value)?.label ?? value}` : label;
  return (
    <label
      className={`relative flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border pl-3 pr-2.5 text-[12.5px] font-medium ${
        on
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {shown}
      <span className="text-[9px] text-[var(--color-faint)]">▾</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ContactsView({
  rows,
  total,
  page,
  pages,
  from,
  to,
  q,
  tagOptions,
  salesOptions,
  stateOptions,
  duplicates,
  activeId,
}: {
  rows: ContactRow[];
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
  q: string;
  tagOptions: { id: string; name: string; color: string }[];
  salesOptions: string[];
  stateOptions: string[];
  duplicates: DupPair[];
  activeId: string | null;
}) {
  const { t } = useShell();
  const s = t.contacts;
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const extra = useSyncExternalStore(
    (l) => {
      colListeners.add(l);
      return () => colListeners.delete(l);
    },
    readCols,
    () => NO_COLS
  );

  const [query, setQuery] = useState(q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [mergeKeep, setMergeKeep] = useState<ContactRow | null>(null);
  const [bulk, setBulk] = useState<null | "tag" | "campaign">(null);
  const [busy, setBusy] = useState(false);
  const colsRef = useOutside(colsOpen, () => setColsOpen(false));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    router.push(`${path}?${next.toString()}`, { scroll: false });
  }

  function onSearch(v: string) {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 400);
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = [...selected];

  async function runBulk(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
    setBulk(null);
    setSelected(new Set());
    router.refresh();
  }

  function exportSelected() {
    const pick = rows.filter((r) => selected.has(r.id));
    const cell = (v: unknown) => {
      const x = v == null ? "" : String(v);
      return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const lines = [
      ["Name", "Phone", "Email", "Order", "Sales", "Tags", "Source"].join(","),
      ...pick.map((r) =>
        [r.name, r.phone, r.email, r.orderRef, r.sales, r.tags.map((x) => x.name).join(" "), r.source].map(cell).join(",")
      ),
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${pick.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const colLabel: Record<OptCol, string> = {
    email: s.colEmail,
    source: s.colSource,
    sourceId: s.colSourceId,
    sourceUrl: s.colSourceUrl,
    company: s.colCompany,
    remarks: s.colRemarks,
    created: s.colCreated,
    blocked: s.colBlocked,
  };
  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]";

  // Header sort and funnels over the contacts on this page (the search box and
  // the Tag / Sales / State pills above still reach the whole book).
  const columns: DataColumn[] = [
    { key: "name", label: s.colName },
    { key: "order", label: s.colOrder },
    { key: "sales", label: s.colSales },
    { key: "tags", label: s.colTags },
    { key: "last", label: s.colLast, filter: false },
    { key: "updated", label: s.colUpdated, filter: false },
    ...extra.map((c) => ({ key: c, label: colLabel[c], filter: c !== "created" && c !== "remarks" && c !== "sourceUrl" })),
  ];
  const dataRows = useMemo<DataRow[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        cells: {},
        search: [r.phone, r.email, r.orderSub].filter(Boolean).join(" "),
        sort: {
          name: r.name,
          order: r.orderRef,
          sales: r.sales,
          tags: r.tags.map((x) => x.name).join(", "),
          last: r.last?.body ?? null,
          updated: r.updatedTs,
          email: r.email,
          source: r.source ? (s.sources[r.source] ?? r.source) : null,
          sourceId: r.sourceId,
          sourceUrl: r.sourceUrl,
          company: r.company,
          remarks: r.remarks,
          created: r.createdTs,
          blocked: r.blocked ? 1 : 0,
        },
        text: {
          tags: r.tags.map((x) => x.name),
          blocked: r.blocked ? s.blockedBadge : "\u2014",
          updated: r.updated,
          created: r.created,
        },
      })),
    [rows, s]
  );
  const table = useDataTable(dataRows, columns, { stateKey: "contacts" });
  const tableRef = useRef<HTMLTableElement>(null);
  const cw = useColumnLayout(tableRef, "contacts", columns);
  const filler = cw.fixed ? 1 : 0;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visible = table.shown.map((d) => byId.get(d.id)).filter((r): r is ContactRow => !!r);
  const allOnPage = visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
      {/* Search · filters · columns */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-accent-ring)] md:max-w-[380px]">
          <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go({ q: query.trim() || null })}
            placeholder={s.search}
            className="w-full bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
        </label>
        <FilterSelect
          label={s.tag}
          value={params.get("tag") ?? ""}
          options={tagOptions.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => go({ tag: v || null })}
          anyLabel={s.any}
        />
        <FilterSelect
          label={s.sales}
          value={params.get("sales") ?? ""}
          options={salesOptions.map((x) => ({ value: x, label: x }))}
          onChange={(v) => go({ sales: v || null })}
          anyLabel={s.any}
        />
        <FilterSelect
          label={s.state}
          value={params.get("state") ?? ""}
          options={stateOptions.map((x) => ({ value: x, label: x }))}
          onChange={(v) => go({ state: v || null })}
          anyLabel={s.any}
        />
        <DataCount table={table} />
        <div ref={colsRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setColsOpen((v) => !v)}
            className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M15 4v16" />
            </svg>
            {s.columns}
          </button>
          {colsOpen && (
            <div className="absolute right-0 z-30 mt-1 w-60 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)]">
              <ColumnsList layout={cw} />
              <div className="mx-1 my-1.5 border-t border-[var(--color-border-subtle)]" />
              <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{s.moreFields}</div>
              {OPTIONAL.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12.5px] hover:bg-[var(--color-surface-2)]">
                  <input
                    type="checkbox"
                    checked={extra.includes(c)}
                    onChange={() => writeCols(extra.includes(c) ? extra.filter((x) => x !== c) : [...extra, c])}
                    className="accent-[var(--color-accent)]"
                  />
                  {colLabel[c]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Possible duplicates */}
      {duplicates.length > 0 && (
        <div className="flex items-start gap-3 rounded-[10px] border border-[rgba(110,77,18,0.25)] bg-[var(--color-warning-soft)] px-4 py-3 text-[12.5px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="1.8" strokeLinecap="round" className="mt-0.5 shrink-0">
            <circle cx="9" cy="8" r="3.2" />
            <circle cx="16" cy="9" r="2.6" />
            <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M14 14c3 0 6 1.6 6 4.5" />
          </svg>
          <p className="flex-1 text-[var(--color-warning)]">
            <b className="font-semibold">{fmt(s.dupTitle, { n: duplicates.length })}</b> {s.dupBody}
          </p>
          <button type="button" onClick={() => setDupOpen(true)} className="shrink-0 font-semibold text-[var(--color-warning)] hover:underline">
            {s.review}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {selected.size > 0 && (
          <div className="relative flex items-center gap-1 bg-[var(--color-ink)] px-3 py-2.5 text-[13px] font-semibold text-white">
            <span className="mr-3 border-r border-white/20 pr-4">{fmt(s.selected, { n: selected.size })}</span>
            <button type="button" onClick={() => setBulk(bulk === "tag" ? null : "tag")} className="rounded-[6px] px-2.5 py-1 hover:bg-white/10">
              {s.addTag}
            </button>
            <button type="button" onClick={() => setBulk(bulk === "campaign" ? null : "campaign")} className="rounded-[6px] px-2.5 py-1 hover:bg-white/10">
              {s.addToCampaign}
            </button>
            <button type="button" onClick={exportSelected} className="rounded-[6px] px-2.5 py-1 hover:bg-white/10">
              {s.export}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBulk(() => bulkBlockContacts(ids, true))}
              className="rounded-[6px] px-2.5 py-1 hover:bg-white/10"
            >
              {s.block}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto font-medium text-white/60 hover:text-white">
              {s.clear}
            </button>
            {bulk && (
              <div className="absolute left-3 top-full z-30 mt-1 w-64 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-ink)] shadow-[var(--shadow-popover)]">
                <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{s.pickTag}</div>
                {bulk === "campaign" && <p className="px-2 pb-1.5 text-[11.5px] font-normal text-[var(--color-faint)]">{s.campaignHint}</p>}
                <div className="max-h-56 overflow-y-auto">
                  {tagOptions.map((tg) => (
                    <button
                      key={tg.id}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runBulk(async () => {
                          await bulkTagContacts(ids, tg.id);
                          if (bulk === "campaign") router.push("/campaigns");
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] font-medium hover:bg-[var(--color-surface-2)]"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: tg.color }} />
                      {tg.name}
                    </button>
                  ))}
                </div>
                {busy && <p className="px-2 pt-1 text-[11.5px] font-normal text-[var(--color-faint)]">{s.working}</p>}
              </div>
            )}
          </div>
        )}

        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          <table ref={tableRef} style={cw.tableStyle} className={`w-full min-w-[700px] border-collapse [&_th]:whitespace-nowrap text-[13px] ${cw.tableClass}`}>
            <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className={`w-10 px-3 ${cw.leadProps(undefined, true).className}`} style={cw.leadProps(undefined, true).style}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set(visible.map((r) => r.id)))}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                </th>
                {cw.cols.map((c) => {
                  const { frozenClass, ...head } = cw.headProps(c.key);
                  return (
                    <th key={c.key} {...head} className={`${th} group/th relative ${cw.fixed ? "overflow-hidden" : ""} ${frozenClass}`}>
                      <DataHead column={c} table={table} />
                      {cw.handle(c.key)}
                    </th>
                  );
                })}
                {cw.fixed && <th aria-hidden className="p-0" />}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 && visible.length === 0 && (
                <tr>
                  <td colSpan={cw.cols.length + 2 + filler} className="px-4 py-10 text-center text-[var(--color-faint)]">
                    {t.table.noMatch}
                  </td>
                </tr>
              )}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cw.cols.length + 2 + filler} className="px-4 py-10 text-center text-[var(--color-faint)]">
                    {q ? fmt(s.noMatch, { q }) : s.none}
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const on = r.id === activeId;
                const sel = selected.has(r.id);
                const look = on ? "active" : sel ? "selected" : undefined;
                const lead = cw.leadProps(look);
                return (
                  <tr
                    key={r.id}
                    onClick={() => go({ id: on ? null : r.id, page: params.get("page") })}
                    className={`group/row relative cursor-pointer border-b border-[var(--color-border-subtle)] ${
                      on ? "bg-[rgba(224,239,242,0.55)]" : sel ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    <td className={`relative px-3 ${lead.className}`} style={lead.style} onClick={(e) => e.stopPropagation()}>
                      {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--color-accent)]" />}
                      <input type="checkbox" aria-label={r.name} checked={sel} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[var(--color-accent)]" />
                    </td>
                    {cw.cols.map((c) => {
                      const cell = cw.cellProps(c.key, look);
                      return (
                        <td key={c.key} className={`${CELL_CLASS[c.key] ?? EXTRA_CELL} ${cell.className}`} style={cell.style}>
                          {contactCell(c.key, r, s)}
                        </td>
                      );
                    })}
                    {cw.fixed && <td className="p-0" />}
                    <td className="px-2" onClick={(e) => e.stopPropagation()}>
                      <RowMenu row={r} onMerge={() => setMergeKeep(r)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-4 py-2.5 text-[12px] text-[var(--color-faint)]">
          <span>{fmt(s.showing, { from, to, total: total.toLocaleString("en-MY") })}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => go({ page: String(page - 1) })}
              className="h-[30px] rounded-[8px] border border-[var(--color-border)] px-3 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)]"
            >
              {s.prev}
            </button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => go({ page: String(page + 1) })}
              className="h-[30px] rounded-[8px] border border-[var(--color-border)] px-3 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)]"
            >
              {s.next}
            </button>
          </div>
        </div>
      </div>

      <DataMenus table={table} />
      {cw.menu}
      {dupOpen && <DupReview pairs={duplicates} onClose={() => setDupOpen(false)} />}
      {mergeKeep && (
        <DupReview
          pairs={rows
            .filter((r) => r.id !== mergeKeep.id)
            .map((r) => ({
              a: { id: mergeKeep.id, name: mergeKeep.name, phone: mergeKeep.phone, source: mergeKeep.source },
              b: { id: r.id, name: r.name, phone: r.phone, source: r.source },
            }))}
          onClose={() => setMergeKeep(null)}
        />
      )}
    </div>
  );
}

/** Row ⋯ menu: Block / Unblock, Merge…, Delete. */
function RowMenu({ row, onMerge }: { row: ContactRow; onMerge: () => void }) {
  const { t } = useShell();
  const s = t.contacts;
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
        className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)]"
      >
        <IconDots width={15} height={15} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
          <form action={setContactBlocked}>
            <input type="hidden" name="contactId" value={row.id} />
            <input type="hidden" name="blocked" value={row.blocked ? "0" : "1"} />
            <button type="submit" className="w-full px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
              {row.blocked ? s.unblock : s.block}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onMerge();
            }}
            className="w-full px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            {s.merge}
          </button>
          <div className="px-1.5 py-1">
            <DeleteContactButton contactId={row.id} name={row.name} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Pairs to merge: the left record is kept, the right one is folded into it. */
function DupReview({ pairs, onClose }: { pairs: DupPair[]; onClose: () => void }) {
  const { t } = useShell();
  const s = t.contacts;
  const router = useRouter();
  const [done, setDone] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const label = (x: DupPair["a"]) => (
    <div className="min-w-0">
      <div className="truncate text-[13px] font-medium text-[var(--color-ink)]">{x.name ?? x.phone}</div>
      <div className="truncate text-[11.5px] tabular-nums text-[var(--color-faint)]">
        {x.phone} · {s.sources[x.source ?? "none"] ?? x.source}
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,16,32,0.45)] p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85dvh] w-full max-w-[620px] flex-col rounded-[16px] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-ink)]">{s.mergeTitle}</div>
            <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">{s.mergeHint}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={s.close} className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="scroll-thin flex flex-col gap-2 overflow-y-auto px-5 py-4">
          {pairs.map((p, i) => (
            <div key={i} className="flex items-center gap-3 rounded-[10px] border border-[var(--color-border)] px-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-px text-[10px] font-semibold uppercase text-[var(--color-accent-ink)]">{s.keep}</span>
                {label(p.a)}
              </div>
              <span className="text-[var(--color-faint)]">←</span>
              <div className="min-w-0 flex-1">{label(p.b)}</div>
              {done.has(i) ? (
                <span className="text-[12px] font-semibold text-[var(--color-success)]">{s.merged}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={async () => {
                    setBusy(i);
                    setErr(null);
                    const fd = new FormData();
                    fd.set("keepId", p.a.id);
                    fd.set("mergeId", p.b.id);
                    const res = await mergeContacts(fd);
                    setBusy(null);
                    if (res.ok) {
                      setDone((d) => new Set(d).add(i));
                      router.refresh();
                    } else setErr(res.error ?? null);
                  }}
                  className="h-[30px] shrink-0 rounded-[8px] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {busy === i ? s.working : s.mergeInto}
                </button>
              )}
            </div>
          ))}
          {err && <p className="text-[12px] text-[var(--color-danger)]">{err}</p>}
        </div>
      </div>
    </div>
  );
}

// Each column's <td> classes and contents, by column key, so the table can
// draw its columns in the viewer's order (frozen first) and skip hidden ones.
const CELL_CLASS: Record<string, string> = {
  name: "max-w-[210px] px-3 py-2.5",
  order: "px-3 py-2.5",
  sales: "px-3 py-2.5 uppercase text-[var(--color-ink)]",
  tags: "px-3 py-2.5",
  last: "max-w-[170px] px-3 py-2.5",
  updated: "whitespace-nowrap px-3 py-2.5 text-[12px] text-[var(--color-faint)]",
};
const EXTRA_CELL = "max-w-[200px] truncate px-3 py-2.5 text-[12.5px] text-[var(--color-muted)]";

function contactCell(key: string, r: ContactRow, s: Dict["contacts"]): React.ReactNode {
  switch (key) {
    case "name":
      return (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.name} blocked={r.blocked} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-[var(--color-ink)]">{r.name}</span>
              {r.blocked && (
                <span className="rounded-full bg-[var(--color-danger-soft)] px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-danger)]">
                  {s.blockedBadge}
                </span>
              )}
            </div>
            <div className="text-[11.5px] tabular-nums text-[var(--color-faint)]">{r.phone}</div>
          </div>
        </div>
      );
    case "order":
      return r.orderRef ? (
        <>
          <div className="font-semibold text-[var(--color-brand)]">{r.orderRef}</div>
          {r.orderSub && <div className="text-[11.5px] text-[var(--color-faint)]">{r.orderSub}</div>}
        </>
      ) : (
        <span className="text-[var(--color-brand)]">—</span>
      );
    case "sales":
      return r.sales ?? "—";
    case "tags":
      return (
        <div className="flex flex-wrap gap-1">
          {r.tags.map((tg) => (
            <span key={tg.id} className="rounded-[4px] px-1.5 py-px text-[10.5px] font-medium" style={{ background: `${tg.color}1f`, color: tg.color }}>
              {tg.name}
            </span>
          ))}
        </div>
      );
    case "last":
      return r.last ? (
        <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-muted)]">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.last.inbound ? "bg-[var(--color-danger)]" : "bg-[var(--color-success)]"}`} />
          <span className="truncate">{r.last.body}</span>
        </span>
      ) : (
        <span className="text-[var(--color-faint)]">—</span>
      );
    case "updated":
      return r.updated;
    case "sourceUrl":
      return r.sourceUrl ? (
        <a href={r.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--color-accent)] hover:underline">
          {r.sourceUrl}
        </a>
      ) : (
        "—"
      );
    case "blocked":
      return r.blocked ? "✓" : "—";
    case "source":
      return r.source ? (s.sources[r.source] ?? r.source) : "—";
    default:
      return ((r as unknown as Record<string, unknown>)[key] as string | null) ?? "—";
  }
}

"use client";

// The list table every Connect page uses, after the Houzs ERP's DataTable:
// a search box over the rows, click a header to sort, a funnel on each
// header to sort A→Z / Z→A or tick which values to show (with counts,
// Select all / Invert / Clear), and header edges to drag for column widths.
//
// Rows come in already rendered: a server page builds each cell as JSX and
// passes it with the plain values this table sorts, searches and filters on.
// That keeps server-rendered rows (forms posting to server actions, links)
// exactly as they were; only the ordering and the hiding happen here, over
// the rows the page loaded.

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";

export type DataColumn = {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  /** Extra classes for this column's <th> and <td> (width, padding). */
  className?: string;
  /** False: no sorting on this column (an actions column). */
  sort?: boolean;
  /** False: no funnel on this column (values unique to each row). */
  filter?: boolean;
};

export type CellValue = string | number | null | undefined;

export type DataRow = {
  id: string;
  /** The rendered cell, per column key. */
  cells: Record<string, ReactNode>;
  /** What each column sorts by: a number (amounts, times) or text. Missing / null sorts last. */
  sort?: Record<string, CellValue>;
  /**
   * What the funnel lists and the search box matches, per column. Defaults to
   * the sort value as text. An array for a cell holding several values (tags):
   * the funnel lists each one and the row matches when any is ticked.
   */
  text?: Record<string, string | string[] | null | undefined>;
  /** More text the search box should find this row by (a phone number, an email). */
  search?: string;
  /** Clicking the row (outside its links / buttons / forms) opens this. */
  href?: string;
  /** Highlight as the selected row. */
  active?: boolean;
};

type Sort = { key: string; dir: "asc" | "desc" } | null;
type Saved = { q: string; sort: Sort; filters: Record<string, string[]> };

const BLANK = "\u0000blank";
const INTERACTIVE = "a,button,input,select,textarea,label,form,[role=button],[data-row-ignore]";

function textsOf(row: DataRow, key: string): string[] {
  const t = row.text?.[key];
  if (Array.isArray(t)) return t.length ? t.map((x) => x.trim() || BLANK) : [BLANK];
  const v = t ?? row.sort?.[key];
  const s = v == null ? "" : String(v).trim();
  return [s || BLANK];
}

function compare(a: CellValue, b: CellValue): number {
  const an = a == null || a === "";
  const bn = b == null || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // blanks last, either direction
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Search, sort and funnel filters over `rows`: what DataTable runs on, for tables that draw their own rows. */
export function useDataTable(
  rows: DataRow[],
  columns: DataColumn[],
  opts: { initialSort?: Sort; stateKey?: string } = {}
) {
  const { initialSort = null, stateKey } = opts;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>(initialSort);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  // Restore after mount, never during render: the server render has no
  // session storage, and the first client render must match it.
  const restored = useRef(false);
  const firstSort = useRef(initialSort);
  useEffect(() => {
    if (!stateKey || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(`dt:${stateKey}`);
      if (!raw) return;
      const s = JSON.parse(raw) as Saved;
      /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from this tab's storage */
      setQ(s.q ?? "");
      setSort(s.sort ?? firstSort.current);
      setFilters(s.filters ?? {});
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, [stateKey]);
  useEffect(() => {
    if (!stateKey || !restored.current) return;
    try {
      sessionStorage.setItem(`dt:${stateKey}`, JSON.stringify({ q, sort, filters } satisfies Saved));
    } catch {}
  }, [stateKey, q, sort, filters]);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const active = Object.entries(filters).filter(([, v]) => v.length > 0);
    let out = rows.filter((r) => {
      for (const [key, vals] of active) {
        const set = new Set(vals);
        if (!textsOf(r, key).some((v) => set.has(v))) return false;
      }
      if (!terms.length) return true;
      const hay = [...columns.flatMap((c) => textsOf(r, c.key).filter((v) => v !== BLANK)), r.search ?? ""].join(" ").toLowerCase();
      return terms.every((w) => hay.includes(w));
    });
    if (sort && byKey.get(sort.key)?.sort !== false) {
      const k = sort.key;
      const sign = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a.sort?.[k] ?? (a.text?.[k] as CellValue);
        const bv = b.sort?.[k] ?? (b.text?.[k] as CellValue);
        if (av == null || av === "" || bv == null || bv === "") return compare(av, bv); // blanks stay last
        return sign * compare(av, bv);
      });
    }
    return out;
  }, [rows, columns, byKey, q, filters, sort]);

  return {
    rows,
    columns,
    byKey,
    q,
    setQ,
    sort,
    setSort,
    /** Header click: A→Z, then Z→A, then back to the page's own order. */
    clickSort: (key: string) => setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null)),
    filters,
    setFilters,
    menu,
    setMenu,
    shown,
    filtered: q.trim() !== "" || Object.values(filters).some((v) => v.length > 0),
    reset: () => {
      setQ("");
      setFilters({});
    },
  };
}

export type DataTableState = ReturnType<typeof useDataTable>;

// ── Column widths ───────────────────────────────────────────
// As in the Houzs ERP: drag a header's right edge to resize a column,
// double-click it to fit the column to its content. The table opens at its
// natural layout; those header widths are read once and the table switches to
// a fixed layout, so resizing one column never moves the others (a blank
// last column takes the slack). Dragged widths are this viewer's, kept in
// this browser per table (`dt:widths:v2:<stateKey>`; v1 held widths saved
// while #102 collapsed `max-w-0` columns to 64px, so it is not read).

const MIN_COL = 64;
const MAX_FIT = 800;

type Measured = { sig: string; widths: Record<string, number>; extra: number };

/**
 * Resizable columns for a table: pass the <table>'s ref, put `tableStyle` on
 * it, `headProps(key)` and `handle(key)` on each data column's <th> (which
 * needs `relative`), and a `<th />` / `<td />` filler before any trailing
 * non-data column while `fixed`.
 */
export function useColumnWidths(
  tableRef: React.RefObject<HTMLTableElement | null>,
  stateKey: string | undefined,
  keys: string[],
  enabled = true
) {
  const { t } = useShell();
  const storageKey = enabled && stateKey ? `dt:widths:v2:${stateKey}` : null;
  const [stored, setStored] = useState<Record<string, number>>({});
  const storedRef = useRef(stored);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const sig = keys.join("\u0001");
  const fixed = enabled && measured?.sig === sig;

  // Restore after mount: the server render has no storage, and the first
  // client render must match it.
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (stateKey) localStorage.removeItem(`dt:widths:${stateKey}`); // the v1 key, see above
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v >= MIN_COL && v <= 2000) clean[k] = Math.round(v);
      storedRef.current = clean;
      setStored(clean); // eslint-disable-line react-hooks/set-state-in-effect -- one-time restore from this browser's storage
    } catch {}
  }, [storageKey, stateKey]);

  // Read the natural layout once (again when the columns change), before paint.
  useLayoutEffect(() => {
    if (!enabled || fixed) return;
    const table = tableRef.current;
    const heads = table?.querySelectorAll<HTMLElement>("thead th[data-col-key]");
    if (!table || !heads?.length) return;
    const widths: Record<string, number> = {};
    let sum = 0;
    for (const th of heads) {
      const w = th.getBoundingClientRect().width;
      if (w <= 0) return; // not laid out yet (a hidden tab): try on a later render
      widths[th.dataset.colKey!] = Math.max(MIN_COL, Math.round(w));
      sum += w;
    }
    const extra = Math.max(0, Math.round(table.getBoundingClientRect().width - sum));
    setMeasured({ sig, widths, extra });
  }, [enabled, fixed, sig, tableRef]);

  const save = (next: Record<string, number>, persist: boolean) => {
    storedRef.current = next;
    setStored(next);
    if (persist && storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
    }
  };

  const widthOf = (key: string): number | undefined => stored[key] ?? (fixed ? measured!.widths[key] : undefined);
  const total = fixed ? keys.reduce((n, k) => n + (widthOf(k) ?? MIN_COL), 0) + measured!.extra : 0;

  const start = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      save({ ...storedRef.current, [key]: Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)) }, false);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      save(storedRef.current, true); // write storage once, when the drag ends
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // Fit: lay the table out by content for a moment (no paint happens in
  // between), with this column on one line, and read its natural width.
  const fit = (key: string) => {
    const table = tableRef.current;
    const th = table?.querySelector<HTMLTableCellElement>(`thead th[data-col-key="${CSS.escape(key)}"]`);
    if (!table || !th) return;
    const idx = th.cellIndex;
    const n = (th.parentElement as HTMLTableRowElement).cells.length;
    const cells = [th, ...[...(table.tBodies[0]?.rows ?? [])].filter((r) => r.cells.length === n).map((r) => r.cells[idx])];
    const was = { layout: table.style.tableLayout, width: table.style.width, min: table.style.minWidth, th: th.style.cssText };
    const wraps = cells.map((c) => c.style.whiteSpace);
    table.style.tableLayout = "auto";
    table.style.width = "max-content";
    table.style.minWidth = "0";
    Object.assign(th.style, { width: "", minWidth: "", maxWidth: "" });
    for (const c of cells) c.style.whiteSpace = "nowrap";
    const natural = th.getBoundingClientRect().width;
    cells.forEach((c, i) => (c.style.whiteSpace = wraps[i]));
    Object.assign(table.style, { tableLayout: was.layout, width: was.width, minWidth: was.min });
    th.style.cssText = was.th;
    save({ ...storedRef.current, [key]: Math.min(MAX_FIT, Math.max(MIN_COL, Math.ceil(natural))) }, true);
  };

  return {
    /** Laid out at fixed widths (render the filler cells). */
    fixed,
    tableStyle: fixed ? ({ tableLayout: "fixed", width: "100%", minWidth: total } as const) : undefined,
    /**
     * For the <table> while fixed: lifts the columns' own max-widths. Pages
     * size columns with `w-[36%] max-w-0` (truncate instead of grow) or
     * `max-w-[130px]`; at a fixed layout max-w-0 collapsed the column to its
     * padding and a cap stopped a drag.
     */
    tableClass: fixed ? "[&_td]:max-w-none [&_th]:max-w-none" : "",
    headProps: (key: string) => {
      const w = widthOf(key);
      return { "data-col-key": key, style: w ? { width: w, minWidth: w, maxWidth: w } : undefined };
    },
    handle: (key: string) =>
      enabled ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={t.table.resize}
          title={t.table.resize}
          onPointerDown={(e) => start(e, key)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            fit(key);
          }}
          className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none opacity-0 transition-opacity hover:bg-[var(--color-accent)] hover:opacity-40 group-hover/th:opacity-100 group-hover/th:bg-[var(--color-border-strong)]"
        />
      ) : null,
  };
}

export type ColumnWidths = ReturnType<typeof useColumnWidths>;

/** A header's contents: the label (click to sort) and its funnel. Goes inside a <th>. */
export function DataHead({ column: c, table }: { column: DataColumn; table: DataTableState }) {
  const { t } = useShell();
  const L = t.table;
  const sorted = table.sort?.key === c.key ? table.sort.dir : null;
  const hasFilter = (table.filters[c.key]?.length ?? 0) > 0;
  const align = c.align === "center" ? "justify-center" : c.align === "right" ? "justify-end" : "";
  return (
    <div className={`group flex items-center gap-1 ${align}`}>
      {c.sort === false ? (
        <span className="truncate">{c.label}</span>
      ) : (
        <button
          type="button"
          onClick={() => table.clickSort(c.key)}
          title={fmt(L.sortBy, { col: c.label })}
          className={`flex min-w-0 items-center gap-1 uppercase hover:text-[var(--color-ink)] ${sorted ? "text-[var(--color-ink)]" : ""}`}
        >
          <span className="truncate">{c.label}</span>
          <span className={`text-[10px] ${sorted ? "" : "opacity-0 group-hover:opacity-60"}`}>{sorted === "desc" ? "↓" : "↑"}</span>
        </button>
      )}
      {c.filter !== false && (
        <button
          type="button"
          data-dt-funnel=""
          aria-label={fmt(L.filterBy, { col: c.label })}
          title={fmt(L.filterBy, { col: c.label })}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            table.setMenu((m) => (m?.key === c.key ? null : { key: c.key, x: r.left, y: r.bottom + 4 }));
          }}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-[4px] transition-opacity hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] ${
            hasFilter ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] opacity-100" : "opacity-40 group-hover:opacity-100"
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill={hasFilter ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
            <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** The open funnel menu, if any. Render once per table. */
export function DataMenus({ table }: { table: DataTableState }) {
  const { menu, setMenu, byKey, rows, filters, sort, setSort, setFilters } = table;
  const column = menu ? byKey.get(menu.key) : null;
  if (!menu || !column) return null;
  return (
    <FilterMenu
      column={column}
      rows={rows}
      at={menu}
      selected={filters[menu.key] ?? []}
      sorted={sort?.key === menu.key ? sort.dir : null}
      onSort={(dir) => {
        setSort({ key: menu.key, dir });
        setMenu(null);
      }}
      onChange={(vals) => setFilters((f) => ({ ...f, [menu.key]: vals }))}
      onClose={() => setMenu(null)}
    />
  );
}

/** The search box DataTable shows above its rows. */
export function DataSearch({ table, placeholder }: { table: DataTableState; placeholder?: string }) {
  const { t } = useShell();
  const L = t.table;
  return (
    <div className="flex h-[36px] min-w-[220px] max-w-[360px] flex-1 items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-accent-ring)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--color-faint)]" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={table.q}
        onChange={(e) => table.setQ(e.target.value)}
        placeholder={placeholder ?? L.search}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
      />
      {table.q && (
        <button type="button" onClick={() => table.setQ("")} aria-label={L.clear} className="text-[14px] leading-none text-[var(--color-faint)] hover:text-[var(--color-ink)]">
          ×
        </button>
      )}
    </div>
  );
}

/** "3 of 9 · Reset filters", while a search or a funnel narrows the rows. */
export function DataCount({ table }: { table: DataTableState }) {
  const { t } = useShell();
  const L = t.table;
  if (!table.filtered) return null;
  return (
    <>
      <span className="text-[12px] tabular-nums text-[var(--color-faint)]">{fmt(L.count, { n: table.shown.length, total: table.rows.length })}</span>
      <button type="button" onClick={table.reset} className="text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
        {L.reset}
      </button>
    </>
  );
}

export function DataTable({
  columns,
  rows,
  search = true,
  searchPlaceholder,
  initialSort = null,
  empty,
  toolbar,
  minWidth = 720,
  stateKey,
  className = "",
  resizable = true,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  /** False when the page has its own search (one that reaches past the loaded rows). */
  search?: boolean;
  searchPlaceholder?: string;
  initialSort?: Sort;
  /** Shown when there are no rows at all (filters aside). */
  empty?: ReactNode;
  /** Extra controls at the right of the search row. */
  toolbar?: ReactNode;
  minWidth?: number;
  /** Remember search / sort / filters for this table in this browser tab (and column widths in this browser). */
  stateKey?: string;
  className?: string;
  /** Drag a header edge to resize its column (on by default). */
  resizable?: boolean;
}) {
  const { t } = useShell();
  const L = t.table;
  const router = useRouter();
  const table = useDataTable(rows, columns, { initialSort, stateKey });
  const { shown, filtered } = table;
  const tableRef = useRef<HTMLTableElement>(null);
  const cw = useColumnWidths(tableRef, stateKey, columns.map((c) => c.key), resizable);

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {(search || toolbar || filtered) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <DataSearch table={table} placeholder={searchPlaceholder} />}
          <DataCount table={table} />
          {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table ref={tableRef} className={`w-full text-left text-[13px] ${cw.tableClass}`} style={cw.tableStyle ?? { minWidth }}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {columns.map((c) => {
                const sorted = table.sort?.key === c.key ? table.sort.dir : null;
                return (
                  <th
                    key={c.key}
                    {...cw.headProps(c.key)}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={`group/th relative whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)] ${
                      cw.fixed ? "overflow-hidden" : ""
                    } ${c.className ?? ""}`}
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
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={
                  r.href
                    ? (e) => {
                        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
                        if (e.metaKey || e.ctrlKey) window.open(r.href, "_blank");
                        else router.push(r.href!, { scroll: false });
                      }
                    : undefined
                }
                className={`border-b border-[var(--color-border-subtle)] align-middle last:border-0 ${r.href ? "cursor-pointer" : ""} ${
                  r.active
                    ? "bg-[rgba(224,239,242,0.55)] shadow-[inset_2px_0_0_var(--color-accent)]"
                    : "hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-2.5 ${c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : ""} ${
                      cw.fixed ? "overflow-hidden break-words" : ""
                    } ${c.className ?? ""}`}
                  >
                    {r.cells[c.key] ?? <span className="text-[var(--color-faint)]">—</span>}
                  </td>
                ))}
                {cw.fixed && <td className="p-0" />}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length + (cw.fixed ? 1 : 0)} className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {rows.length === 0 ? (empty ?? L.none) : L.noMatch}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DataMenus table={table} />
    </div>
  );
}

/** The funnel popover: sort, then tick which values to show. */
function FilterMenu({
  column,
  rows,
  at,
  selected,
  sorted,
  onSort,
  onChange,
  onClose,
}: {
  column: DataColumn;
  rows: DataRow[];
  at: { x: number; y: number };
  selected: string[];
  sorted: "asc" | "desc" | null;
  onSort: (dir: "asc" | "desc") => void;
  onChange: (vals: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useShell();
  const L = t.table;
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: at.y, left: at.x });

  // Keep the popover on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
      top: at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h - 28) : at.y,
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      // A funnel's own click toggles the menu; closing here first would reopen it.
      if (el.closest?.("[data-dt-funnel]")) return;
      if (ref.current && !ref.current.contains(el)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    // Next tick: the click that opened the menu must not close it.
    const id = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const counts = new Map<string, number>();
  for (const r of rows) for (const v of new Set(textsOf(r, column.key))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const values = [...counts.entries()].sort((a, b) =>
    a[0] === BLANK ? 1 : b[0] === BLANK ? -1 : a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" })
  );
  const ql = query.trim().toLowerCase();
  const shownVals = (ql ? values.filter(([v]) => (v === BLANK ? L.blank : v).toLowerCase().includes(ql)) : values).map(([v]) => v);
  const sel = new Set(selected);
  // Select all / Invert act on the values the search shows, keeping ticks outside it.
  const selectAll = () => onChange([...new Set([...selected, ...shownVals])]);
  const invert = () => {
    const inView = new Set(shownVals);
    onChange([...selected.filter((v) => !inView.has(v)), ...shownVals.filter((v) => !sel.has(v))]);
  };
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)] disabled:hover:bg-transparent";
  const link = "rounded px-1.5 py-0.5 text-[var(--color-accent)] hover:bg-[var(--color-surface-2)] disabled:text-[var(--color-faint)] disabled:hover:bg-transparent";

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[120] flex max-h-[calc(100dvh-16px)] w-[240px] flex-col overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
      style={pos}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-muted)]">
        {column.label}
      </div>
      {column.sort !== false && (
        <div className="shrink-0 border-b border-[var(--color-border-subtle)] py-1">
          <button type="button" className={`${item} ${sorted === "asc" ? "font-semibold text-[var(--color-accent)]" : ""}`} onClick={() => onSort("asc")}>
            <span className="w-4 text-center text-[11px] text-[var(--color-faint)]">↑</span>
            {L.sortAsc}
          </button>
          <button type="button" className={`${item} ${sorted === "desc" ? "font-semibold text-[var(--color-accent)]" : ""}`} onClick={() => onSort("desc")}>
            <span className="w-4 text-center text-[11px] text-[var(--color-faint)]">↓</span>
            {L.sortDesc}
          </button>
        </div>
      )}
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-3 py-1.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={L.searchValues}
          className="w-full rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border-subtle)] px-2 py-1.5 text-[11px] font-semibold">
        <button type="button" className={link} onClick={selectAll} disabled={shownVals.length === 0}>
          {L.selectAll}
        </button>
        <span className="text-[var(--color-faint)]">·</span>
        <button type="button" className={link} onClick={invert} disabled={shownVals.length === 0}>
          {L.invert}
        </button>
        <span className="text-[var(--color-faint)]">·</span>
        <button type="button" className={link} onClick={() => onChange([])} disabled={selected.length === 0}>
          {L.clear}
        </button>
      </div>
      <div className="max-h-[260px] min-h-0 overflow-y-auto overscroll-contain py-1">
        {shownVals.length === 0 && <div className="px-3 py-2 text-[12px] text-[var(--color-faint)]">{L.noValues}</div>}
        {shownVals.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
            <input
              type="checkbox"
              checked={sel.has(v)}
              onChange={() => onChange(sel.has(v) ? selected.filter((x) => x !== v) : [...selected, v])}
              className="accent-[var(--color-accent)]"
            />
            <span className={`min-w-0 flex-1 truncate ${v === BLANK ? "italic text-[var(--color-faint)]" : ""}`} title={v === BLANK ? L.blank : v}>
              {v === BLANK ? L.blank : v}
            </span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--color-faint)]">{counts.get(v)}</span>
          </label>
        ))}
      </div>
    </div>,
    document.body
  );
}

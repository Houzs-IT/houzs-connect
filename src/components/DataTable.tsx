"use client";

// The list table every Connect page uses, after the Houzs ERP's DataTable:
// a search box over the rows, click a header to sort, a funnel on each
// header to sort A→Z / Z→A or tick which values to show (with counts,
// Select all / Invert / Clear), header edges to drag for column widths, and
// right-click / "Columns" to freeze or hide columns.
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

// ── Column layout: widths, order, frozen and hidden columns, wrap ─
// As in the Houzs ERP. Drag a header's right edge to resize a column,
// double-click it to fit the column to its content. Drag a header (or a row
// in "Columns") onto another to move it there. Right-click a header (or open
// "Columns") to freeze columns at the left edge, hide a column, or bring a
// hidden one back. "Wrap" lets long text run onto more lines; off, each row
// is one line and long text ends in "…".
//
// The table opens at its natural layout; those header widths are read once
// and the table switches to a fixed layout, so resizing one column never
// moves the others (a blank last column takes the slack). Frozen columns move
// to the front, in page order, and stick while the table scrolls sideways.
//
// All of it is this viewer's, kept in this browser per table:
// `dt:widths:v2:<stateKey>` (v1 held widths saved while #102 collapsed
// `max-w-0` columns to 64px, so it is not read) and `dt:cols:<stateKey>`
// ({ hidden, pinned, order, wrap }).

const MIN_COL = 64;
const MAX_FIT = 800;

type Measured = { sig: string; widths: Record<string, number>; extra: number; lead: number };
type ColState = { hidden: string[]; pinned: string[]; order: string[]; wrap: boolean };
const NO_STATE: ColState = { hidden: [], pinned: [], order: [], wrap: false };
/** How a row is painted, so a frozen cell can paint the same (it needs a solid background). */
export type RowLook = "active" | "selected" | undefined;

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeJson(key: string | null, value: unknown) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Column layout for a table. Pass the <table>'s ref and every column the page
 * offers; render `cols` (visible, frozen first) instead of them. Put
 * `tableStyle` / `tableClass` on the <table>, `headProps(key)` and
 * `handle(key)` on each data column's <th>, `cellProps(key, look)` on each
 * data <td>, `leadProps(look)` on a leading non-data cell (a checkbox), a
 * `<th />` / `<td />` filler before any trailing non-data column while
 * `fixed`, and `menu` once.
 */
export function useColumnLayout(
  tableRef: React.RefObject<HTMLTableElement | null>,
  stateKey: string | undefined,
  columns: DataColumn[],
  enabled = true
) {
  const { t } = useShell();
  const L = t.table;
  const widthKey = enabled && stateKey ? `dt:widths:v2:${stateKey}` : null;
  const colsKey = enabled && stateKey ? `dt:cols:${stateKey}` : null;
  const [stored, setStored] = useState<Record<string, number>>({});
  const storedRef = useRef(stored);
  const [state, setState] = useState<ColState>(NO_STATE);
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  // The viewer's order (columns it does not know keep their page order, after
  // it), then visible columns, frozen ones first. Never hide them all.
  const orderAt = new Map(state.order.map((k, i) => [k, i]));
  const pageAt = new Map(columns.map((c, i) => [c.key, i]));
  const rank = (k: string) => orderAt.get(k) ?? state.order.length + pageAt.get(k)!;
  const ordered = enabled && state.order.length ? [...columns].sort((a, b) => rank(a.key) - rank(b.key)) : columns;
  const hiddenSet = new Set(state.hidden);
  let visible = enabled ? ordered.filter((c) => !hiddenSet.has(c.key)) : columns;
  if (!visible.length) visible = ordered.slice(0, 1);
  const pinnedSet = new Set(enabled ? state.pinned : []);
  const frozen = visible.filter((c) => pinnedSet.has(c.key));
  const cols = [...frozen, ...visible.filter((c) => !pinnedSet.has(c.key))];
  const sig = cols.map((c) => c.key).join("\u0001");
  const fixed = enabled && measured?.sig === sig;
  const wrap = enabled && state.wrap;

  // Restore after mount: the server render has no storage, and the first
  // client render must match it.
  useEffect(() => {
    if (!widthKey && !colsKey) return;
    if (stateKey) {
      try {
        localStorage.removeItem(`dt:widths:${stateKey}`); // the v1 key, see above
      } catch {}
    }
    const raw = widthKey ? readJson(widthKey) : null;
    const clean: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v >= MIN_COL && v <= 2000) clean[k] = Math.round(v);
    }
    const cs = colsKey ? (readJson(colsKey) as Partial<ColState> | null) : null;
    storedRef.current = clean;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from this browser's storage */
    setStored(clean);
    setState({ hidden: strings(cs?.hidden), pinned: strings(cs?.pinned), order: strings(cs?.order), wrap: cs?.wrap === true });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [widthKey, colsKey, stateKey]);

  // Read the natural layout once (again when the columns change), before paint.
  useLayoutEffect(() => {
    if (!enabled || fixed) return;
    const table = tableRef.current;
    const heads = table?.querySelectorAll<HTMLElement>("thead th[data-col-key]");
    if (!table || !heads?.length) return;
    const box = table.getBoundingClientRect();
    const widths: Record<string, number> = {};
    let sum = 0;
    for (const th of heads) {
      const w = th.getBoundingClientRect().width;
      if (w <= 0) return; // not laid out yet (a hidden tab): try on a later render
      widths[th.dataset.colKey!] = Math.max(MIN_COL, Math.round(w));
      sum += w;
    }
    const extra = Math.max(0, Math.round(box.width - sum));
    const lead = Math.max(0, Math.round(heads[0].getBoundingClientRect().left - box.left));
    setMeasured({ sig, widths, extra, lead });
  }, [enabled, fixed, sig, tableRef]);

  const saveWidths = (next: Record<string, number>, persist: boolean) => {
    storedRef.current = next;
    setStored(next);
    if (persist) writeJson(widthKey, next);
  };
  const saveState = (next: ColState) => {
    setState(next);
    writeJson(colsKey, next);
  };

  const widthOf = (key: string): number | undefined => stored[key] ?? (fixed ? measured!.widths[key] : undefined);
  const total = fixed ? cols.reduce((n, c) => n + (widthOf(c.key) ?? MIN_COL), 0) + measured!.extra : 0;
  // Left offset of each frozen column: the leading non-data cells, then the frozen ones before it.
  const leftOf = new Map<string, number>();
  if (fixed && frozen.length) {
    let x = measured!.lead;
    for (const c of frozen) {
      leftOf.set(c.key, x);
      x += widthOf(c.key) ?? MIN_COL;
    }
  }
  const lastFrozen = frozen[frozen.length - 1]?.key;

  const start = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      saveWidths({ ...storedRef.current, [key]: Math.max(MIN_COL, Math.round(startW + ev.clientX - startX)) }, false);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      saveWidths(storedRef.current, true); // write storage once, when the drag ends
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
    Object.assign(th.style, { width: "", minWidth: "", maxWidth: "", position: "" });
    for (const c of cells) c.style.whiteSpace = "nowrap";
    const natural = th.getBoundingClientRect().width;
    cells.forEach((c, i) => (c.style.whiteSpace = wraps[i]));
    Object.assign(table.style, { tableLayout: was.layout, width: was.width, minWidth: was.min });
    th.style.cssText = was.th;
    saveWidths({ ...storedRef.current, [key]: Math.min(MAX_FIT, Math.max(MIN_COL, Math.ceil(natural))) }, true);
  };

  const hide = (key: string) => {
    if (visible.length <= 1) return;
    saveState({ ...state, hidden: [...state.hidden.filter((k) => k !== key), key], pinned: state.pinned.filter((k) => k !== key) });
  };
  const show = (key: string) => saveState({ ...state, hidden: state.hidden.filter((k) => k !== key) });
  const togglePin = (key: string) =>
    saveState({ ...state, pinned: pinnedSet.has(key) ? state.pinned.filter((k) => k !== key) : [...state.pinned, key] });
  /** Freeze every visible column from the first through this one (as on screen). */
  const freezeUpTo = (key: string) => {
    const i = cols.findIndex((c) => c.key === key);
    if (i >= 0) saveState({ ...state, pinned: cols.slice(0, i + 1).map((c) => c.key) });
  };
  const unfreeze = () => saveState({ ...state, pinned: [] });
  const reset = () => {
    saveState(NO_STATE);
    saveWidths({}, true);
  };
  const toggleWrap = () => saveState({ ...state, wrap: !state.wrap });
  // Move a column to another's place. Not across the frozen / unfrozen divide:
  // frozen columns are drawn first whatever the order, so that move would
  // silently do nothing.
  const canMove = (key: string, target: string) =>
    key !== target && pinnedSet.has(key) === pinnedSet.has(target) && pageAt.has(key) && pageAt.has(target);
  const moveTo = (key: string, target: string) => {
    if (!canMove(key, target)) return;
    const keys = ordered.map((c) => c.key);
    keys.splice(keys.indexOf(key), 1);
    keys.splice(keys.indexOf(target) + (rank(key) < rank(target) ? 1 : 0), 0, key);
    saveState({ ...state, order: keys });
  };
  const dragging = drag?.key;
  const dropSide = (key: string): "left" | "right" | null => {
    if (!drag || drag.over !== key || !canMove(drag.key, key)) return null;
    const at = (k: string) => cols.findIndex((c) => c.key === k);
    return at(drag.key) < at(key) ? "right" : "left";
  };

  const solid = (look: RowLook) =>
    look === "active"
      ? "bg-[#eef6f8]"
      : look === "selected"
        ? "bg-[var(--color-surface-2)]"
        : "bg-[var(--color-surface)] group-hover/row:bg-[var(--color-surface-2)]";

  const labelled = ordered.filter((c) => c.label);
  function labelOf(key: string) {
    return columns.find((c) => c.key === key)?.label ?? "";
  }

  return {
    /** The columns to render, in order: visible ones, frozen first. */
    cols,
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
      const left = leftOf.get(key);
      return {
        "data-col-key": key,
        style: {
          ...(w ? { width: w, minWidth: w, maxWidth: w } : {}),
          ...(left !== undefined ? { position: "sticky" as const, left, zIndex: 20 } : {}),
        },
        onContextMenu: enabled
          ? (e: React.MouseEvent) => {
              e.preventDefault();
              setMenu({ key, x: e.clientX, y: e.clientY });
            }
          : undefined,
        // Drag a header onto another to move it there.
        draggable: enabled && !!labelOf(key),
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          try {
            e.dataTransfer.setData("text/plain", key); // Firefox needs a payload
          } catch {}
          setDrag({ key, over: null });
        },
        onDragOver: (e: React.DragEvent) => {
          if (!drag || !canMove(drag.key, key)) return;
          e.preventDefault(); // allows the drop
          e.dataTransfer.dropEffect = "move";
          if (drag.over !== key) setDrag({ ...drag, over: key });
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          if (drag) moveTo(drag.key, key);
          setDrag(null);
        },
        onDragEnd: () => setDrag(null),
        /** Extra classes: a frozen header needs a background, the last one an edge; the one being dragged dims. */
        extraClass: `${
          left !== undefined ? `bg-[var(--color-surface)] ${key === lastFrozen ? "shadow-[inset_-1px_0_0_var(--color-border)]" : ""}` : ""
        } ${dragging === key ? "opacity-40" : ""} ${enabled && labelOf(key) ? "cursor-grab active:cursor-grabbing" : ""}`,
      };
    },
    /**
     * A data <td>: clipped to its column once fixed — one line ending in "…",
     * or wrapped when Wrap is on — and sticky, painted like its row, while its
     * column is frozen.
     */
    cellProps: (key: string, look?: RowLook) => {
      const left = leftOf.get(key);
      const fit = fixed ? `overflow-hidden ${wrap ? "whitespace-normal break-words" : "whitespace-nowrap text-ellipsis"}` : "";
      if (left === undefined) return { style: undefined, className: fit };
      return {
        style: { position: "sticky" as const, left, zIndex: 10 },
        className: `${fit} ${solid(look)} ${key === lastFrozen ? "shadow-[inset_-1px_0_0_var(--color-border)]" : ""}`,
      };
    },
    /** A leading non-data cell (a checkbox column): sticks at the left while anything is frozen. */
    leadProps: (look?: RowLook, head = false) =>
      leftOf.size
        ? { style: { position: "sticky" as const, left: 0, zIndex: head ? 20 : 10 }, className: head ? "bg-[var(--color-surface)]" : solid(look) }
        : { style: undefined, className: "" },
    /** Inside each data <th>: the resize strip, and the bar showing where a dragged column lands. */
    handle: (key: string) => {
      if (!enabled) return null;
      const side = dropSide(key);
      return (
        <>
          <span
            role="separator"
            aria-orientation="vertical"
            aria-label={L.resize}
            title={L.resize}
            draggable={false}
            onPointerDown={(e) => start(e, key)}
            onMouseDown={(e) => {
              e.preventDefault(); // a resize, never the start of a column drag
              e.stopPropagation();
            }}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              fit(key);
            }}
            className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none opacity-0 transition-opacity hover:bg-[var(--color-accent)] hover:opacity-40 group-hover/th:opacity-100 group-hover/th:bg-[var(--color-border-strong)]"
          />
          {side && (
            <span aria-hidden className={`pointer-events-none absolute top-0 z-20 h-full w-[3px] rounded-full bg-[var(--color-accent)] ${side === "right" ? "right-0" : "left-0"}`} />
          )}
        </>
      );
    },
    /** The header right-click menu; render once. */
    menu:
      menu && enabled ? (
        <ColumnMenu
          at={menu}
          column={columns.find((c) => c.key === menu.key)}
          frozen={pinnedSet.has(menu.key)}
          anyFrozen={pinnedSet.size > 0}
          canHide={visible.length > 1 && !!columns.find((c) => c.key === menu.key)?.label}
          hidden={labelled.filter((c) => hiddenSet.has(c.key))}
          onFreezeUpTo={() => freezeUpTo(menu.key)}
          onTogglePin={() => togglePin(menu.key)}
          onUnfreeze={unfreeze}
          onFit={() => fit(menu.key)}
          onHide={() => hide(menu.key)}
          onShow={show}
          onClose={() => setMenu(null)}
        />
      ) : null,
    /** For the Columns panel: every column with a label, and what it can do. */
    panel: {
      columns: labelled,
      isHidden: (key: string) => hiddenSet.has(key),
      isFrozen: (key: string) => pinnedSet.has(key),
      canHide: visible.length > 1,
      changed: state.hidden.length > 0 || state.pinned.length > 0 || state.order.length > 0 || state.wrap || Object.keys(stored).length > 0,
      hide,
      show,
      togglePin,
      reset,
      canMove,
      moveTo,
      wrap,
      toggleWrap,
    },
  };
}

export type ColumnLayout = ReturnType<typeof useColumnLayout>;

const PinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />
  </svg>
);
const EyeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Right-click on a header: freeze, fit, hide, and bring hidden columns back. */
function ColumnMenu({
  at,
  column,
  frozen,
  anyFrozen,
  canHide,
  hidden,
  onFreezeUpTo,
  onTogglePin,
  onUnfreeze,
  onFit,
  onHide,
  onShow,
  onClose,
}: {
  at: { x: number; y: number };
  column: DataColumn | undefined;
  frozen: boolean;
  anyFrozen: boolean;
  canHide: boolean;
  hidden: DataColumn[];
  onFreezeUpTo: () => void;
  onTogglePin: () => void;
  onUnfreeze: () => void;
  onFit: () => void;
  onHide: () => void;
  onShow: (key: string) => void;
  onClose: () => void;
}) {
  const { t } = useShell();
  const L = t.table;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: at.y, left: at.x });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)), left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)) });
  }, [at]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", away, true);
    };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const item =
    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)] disabled:hover:bg-transparent";
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[120] max-h-[calc(100vh-16px)] min-w-[200px] overflow-y-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-popover)]"
      style={pos}
    >
      {column?.label && <div className="truncate px-2.5 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{column.label}</div>}
      <button type="button" className={item} onClick={run(onFreezeUpTo)}>
        <span className="w-4 text-center">⇤</span>
        {L.freezeUpTo}
      </button>
      <button type="button" className={item} onClick={run(onTogglePin)}>
        <span className="grid w-4 place-items-center">
          <PinIcon />
        </span>
        {frozen ? L.unfreezeCol : L.freezeCol}
      </button>
      {anyFrozen && (
        <button type="button" className={item} onClick={run(onUnfreeze)}>
          <span className="w-4 text-center">↺</span>
          {L.unfreezeAll}
        </button>
      )}
      <div className="my-1 border-t border-[var(--color-border-subtle)]" />
      <button type="button" className={item} onClick={run(onFit)}>
        <span className="w-4 text-center">↔</span>
        {L.fitWidth}
      </button>
      <button type="button" className={item} disabled={!canHide} onClick={run(onHide)}>
        <span className="w-4 text-center">⊘</span>
        {L.hideCol}
      </button>
      {hidden.length > 0 && (
        <>
          <div className="my-1 border-t border-[var(--color-border-subtle)]" />
          <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{L.hiddenCols}</div>
          {hidden.map((c) => (
            <button key={c.key} type="button" className={item} onClick={run(() => onShow(c.key))}>
              <span className="grid w-4 place-items-center">
                <EyeIcon />
              </span>
              {fmt(L.showCol, { col: c.label })}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body
  );
}

/** The Columns panel's list: show / hide and freeze each column, and reset. */
export function ColumnsList({ layout }: { layout: ColumnLayout }) {
  const { t } = useShell();
  const L = t.table;
  const p = layout.panel;
  const [drag, setDrag] = useState<{ key: string; over: string | null } | null>(null);
  return (
    <div className="flex flex-col">
      {p.columns.map((c) => {
        const hidden = p.isHidden(c.key);
        const frozen = p.isFrozen(c.key);
        const target = drag && drag.over === c.key && p.canMove(drag.key, c.key);
        return (
          <div
            key={c.key}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", c.key);
              } catch {}
              setDrag({ key: c.key, over: null });
            }}
            onDragOver={(e) => {
              if (!drag || !p.canMove(drag.key, c.key)) return;
              e.preventDefault();
              if (drag.over !== c.key) setDrag({ ...drag, over: c.key });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag) p.moveTo(drag.key, c.key);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={`flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-[var(--color-surface-2)] ${drag?.key === c.key ? "opacity-40" : ""} ${
              target ? "shadow-[inset_0_2px_0_var(--color-accent)]" : ""
            }`}
          >
            <span aria-hidden title={L.dragToMove} className="cursor-grab select-none text-[12px] leading-none text-[var(--color-faint)]">
              ⋮⋮
            </span>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-0.5 text-[12.5px] text-[var(--color-ink)]">
              <input
                type="checkbox"
                checked={!hidden}
                disabled={!hidden && !p.canHide}
                onChange={() => (hidden ? p.show(c.key) : p.hide(c.key))}
                className="accent-[var(--color-accent)]"
              />
              <span className="truncate">{c.label}</span>
            </label>
            <button
              type="button"
              disabled={hidden}
              onClick={() => p.togglePin(c.key)}
              title={frozen ? L.unfreezeCol : L.freezeCol}
              aria-label={frozen ? L.unfreezeCol : L.freezeCol}
              aria-pressed={frozen}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-[12px] disabled:opacity-30 ${
                frozen ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : "text-[var(--color-faint)] hover:bg-[var(--color-surface-dim)]"
              }`}
            >
              <PinIcon />
            </button>
          </div>
        );
      })}
      <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-[var(--color-border-subtle)] px-2 pb-1 pt-2 text-[12.5px] text-[var(--color-ink)]">
        <input type="checkbox" checked={p.wrap} onChange={p.toggleWrap} className="accent-[var(--color-accent)]" />
        {L.wrapText}
      </label>
      <p className="px-2 pb-1 pt-1 text-[11px] leading-snug text-[var(--color-faint)]">{L.columnsHint}</p>
      {p.changed && (
        <button type="button" onClick={p.reset} className="mx-2 mb-1 self-start text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
          {L.resetLayout}
        </button>
      )}
    </div>
  );
}

/** "Wrap" — long text on more lines, or each row on one line. */
export function WrapButton({ layout }: { layout: ColumnLayout }) {
  const { t } = useShell();
  const on = layout.panel.wrap;
  return (
    <button
      type="button"
      onClick={layout.panel.toggleWrap}
      aria-pressed={on}
      title={on ? t.table.wrapOff : t.table.wrapOn}
      className={`flex h-[34px] items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-medium hover:bg-[var(--color-surface-2)] ${
        on ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4m0 0 2-2m-2 2 2 2M3 18h7" />
      </svg>
      {t.table.wrap}
    </button>
  );
}

/** "Columns" — a button opening ColumnsList. */
export function ColumnsButton({ layout }: { layout: ColumnLayout }) {
  const { t } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const p = layout.panel;
  const off = p.columns.filter((c) => p.isHidden(c.key)).length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        {t.table.columns}
        {off > 0 && <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 text-[11px] text-[var(--color-muted)]">{fmt(t.table.hiddenN, { n: off })}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-popover)]">
          <ColumnsList layout={layout} />
        </div>
      )}
    </div>
  );
}

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
  /** Column tools — resize, freeze, hide (on by default). */
  resizable?: boolean;
}) {
  const { t } = useShell();
  const L = t.table;
  const router = useRouter();
  const table = useDataTable(rows, columns, { initialSort, stateKey });
  const { shown, filtered } = table;
  const tableRef = useRef<HTMLTableElement>(null);
  const cw = useColumnLayout(tableRef, stateKey, columns, resizable);
  // The Columns button only where there is something to choose from.
  const columnsButton = resizable && cw.panel.columns.length >= 4;
  const filler = cw.fixed ? 1 : 0;

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {(search || toolbar || filtered || columnsButton) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && <DataSearch table={table} placeholder={searchPlaceholder} />}
          <DataCount table={table} />
          {(toolbar || columnsButton) && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {toolbar}
              {columnsButton && <WrapButton layout={cw} />}
              {columnsButton && <ColumnsButton layout={cw} />}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table ref={tableRef} className={`w-full text-left text-[13px] ${cw.tableClass}`} style={cw.tableStyle ?? { minWidth }}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              {cw.cols.map((c) => {
                const sorted = table.sort?.key === c.key ? table.sort.dir : null;
                const { extraClass, ...head } = cw.headProps(c.key);
                return (
                  <th
                    key={c.key}
                    {...head}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={`group/th relative whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)] ${
                      cw.fixed ? "overflow-hidden" : ""
                    } ${c.className ?? ""} ${extraClass}`}
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
                className={`group/row border-b border-[var(--color-border-subtle)] align-middle last:border-0 ${r.href ? "cursor-pointer" : ""} ${
                  r.active
                    ? "bg-[rgba(224,239,242,0.55)] shadow-[inset_2px_0_0_var(--color-accent)]"
                    : "hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {cw.cols.map((c) => {
                  const cell = cw.cellProps(c.key, r.active ? "active" : undefined);
                  return (
                    <td
                      key={c.key}
                      style={cell.style}
                      className={`px-4 py-2.5 ${c.align === "center" ? "text-center" : c.align === "right" ? "text-right" : ""} ${c.className ?? ""} ${
                        cell.className
                      }`}
                    >
                      {r.cells[c.key] ?? <span className="text-[var(--color-faint)]">—</span>}
                    </td>
                  );
                })}
                {cw.fixed && <td className="p-0" />}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={cw.cols.length + filler} className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {rows.length === 0 ? (empty ?? L.none) : L.noMatch}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DataMenus table={table} />
      {cw.menu}
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

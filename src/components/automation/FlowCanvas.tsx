"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  useReactFlow,
  useNodesData,
  useViewport,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createPortal } from "react-dom";
import {
  type CriteriaRule,
  type FlowGraph,
  type NodeType,
  type TriggerEvent,
} from "@/lib/automation/types";
import {
  CATEGORY_ORDER,
  NODE_CATALOG,
  nodeMeta,
  type NodeCategory,
} from "@/lib/automation/nodeCatalog";
import {
  listAutomationVersions,
  restoreAutomationVersion,
  saveAutomationGraph,
} from "@/app/(app)/automations/actions";
import {
  findFlowGaps,
  summariseSends,
  triggerSentence,
  type NodeProbe,
} from "@/app/(app)/automations/copy";
import { ActionConfirm } from "@/components/ActionConfirm";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { RunStats } from "@/lib/automation/run-stats";

/** The "Run data" layer: on/off and the last-7-days counts per node. */
const RunCtx = createContext<{ on: boolean; stats: RunStats | null }>({ on: false, stats: null });

/** Nodes where a run parks and waits on the customer or a clock. */
const WAIT_TYPES = new Set(["ask_buttons", "collect_input", "delay"]);

// ────────────────────────────── shared shapes ──────────────────────────────

interface Opt {
  id: string;
  name: string;
}

type HcData = {
  nodeType: string;
  message?: string;
  buttons?: { id: string; label: string }[];
  key?: string;
  value?: string;
  tag?: string;
  status?: string;
  url?: string;
  method?: string;
  body?: string;
  headers?: string;
  saveResponseTo?: string;
  saveTo?: string;
  rules?: CriteriaRule[];
  event?: TriggerEvent;
  callbackId?: string;
  keywords?: string[];
  targetAutomationId?: string;
  targetAutomationName?: string;
  campaignId?: string;
  campaignName?: string;
  agentId?: string;
  sheetId?: string;
  sheetTab?: string;
  columns?: string;
  expression?: string;
  unit?: string;
  amount?: number;
  memberId?: string;
  departmentId?: string;
  [k: string]: unknown;
};

const TRIGGER_EVENTS: { value: TriggerEvent; label: string }[] = [
  { value: "NEW_INCOMING_MESSAGE", label: "New message received" },
  { value: "WEBHOOK", label: "Webhook received (ERP)" },
  { value: "TAG_ADDED", label: "When a tag is added" },
  { value: "ACTION_CALLBACK", label: "Action callback id matches" },
];

const OPERATORS: { value: CriteriaRule["op"]; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "set", label: "is set" },
  { value: "unset", label: "is not set" },
];

/** Does this node type fan out to multiple, branch-labelled outputs? */
function branchesOf(d: HcData): { id: string; label: string }[] | null {
  if (d.nodeType === "criteria_router") {
    const rules = d.rules ?? [];
    return [
      ...rules.map((r, i) => ({ id: r.branch, label: `Rule ${i + 1}` })),
      { id: "default", label: "Else" },
    ];
  }
  if (d.nodeType === "ask_buttons") {
    const btns = d.buttons ?? [];
    return [
      ...btns.map((b) => ({ id: b.id, label: b.label || b.id })),
      { id: "default", label: "No reply" },
    ];
  }
  return null;
}

function summarize(d: HcData): string {
  switch (d.nodeType) {
    case "trigger": {
      const ev = TRIGGER_EVENTS.find((e) => e.value === d.event);
      const base = ev?.label ?? "New message received";
      if (d.event !== "ACTION_CALLBACK") return base;
      // Prefer the single callbackId; fall back to the legacy keywords list.
      const match = d.callbackId?.trim() || (d.keywords?.length ? d.keywords.join(", ") : "");
      return match ? `${base}: ${match}` : base;
    }
    case "send_text":
    case "ai_agent_reply":
      return d.message ?? "";
    case "collect_input":
      return d.message ?? "";
    case "ask_buttons":
      return d.message ?? "";
    case "set_attribute":
      return `${d.key ?? "?"} = ${d.value ?? ""}`;
    case "add_tag":
    case "remove_tag":
      return d.tag ?? "";
    case "criteria_router":
      return "";
    case "jump_to_automation":
      return d.targetAutomationName ?? "";
    case "add_to_drip":
    case "remove_from_drip":
      return d.campaignName ?? "";
    case "google_sheets":
      return d.sheetTab ? `Sheet · ${d.sheetTab}` : d.sheetId ?? "";
    case "eval":
      return d.expression ?? "";
    case "call_rest_api":
      return `${d.method ?? "POST"} ${d.url ?? ""}`;
    case "set_status":
      return d.status ?? "";
    case "delay":
      return d.amount ? `${d.amount} ${d.unit ?? "minutes"}` : "";
    default:
      return "";
  }
}

// ────────────────────────────── node view ──────────────────────────────

function HcNode({ id, data, selected }: NodeProps) {
  const d = data as HcData;
  const meta = nodeMeta(d.nodeType);
  const isTrigger = d.nodeType === "trigger";
  const isEnd = d.nodeType === "end";
  const branches = branchesOf(d);
  const sum = summarize(d);
  const run = useContext(RunCtx);
  const stat = run.on ? run.stats?.perNode[id] : undefined;
  // A step customers are parked on is the one to look at first.
  const stuck = run.on && !!stat?.waiting && WAIT_TYPES.has(d.nodeType);
  const handle = { width: 8, height: 8, border: "2px solid var(--color-surface)" };

  return (
    <div
      className="w-[200px] rounded-[10px] border bg-[var(--color-surface)]"
      style={{
        borderColor: selected ? "var(--color-accent)" : stuck ? "var(--color-brand-bright)" : "var(--color-border)",
        boxShadow: selected
          ? "0 0 0 3px var(--color-accent-ring), 0 4px 14px -6px rgba(17,24,16,0.18)"
          : stuck
            ? "0 0 0 3px color-mix(in srgb, var(--color-brand-bright) 18%, transparent)"
            : "0 1px 2px rgba(17,24,16,0.06)",
      }}
    >
      {!isTrigger && (
        <Handle type="target" position={Position.Top} id="in" style={{ ...handle, background: "var(--color-border-strong)" }} />
      )}
      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <span
          className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] text-[11px] leading-none"
          style={{ background: `${meta.color}22`, color: meta.color }}
        >
          {meta.glyph}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
          {meta.label}
        </span>
        {run.on && (
          <span
            title={stat?.waiting ? `${stat.waiting} waiting here now` : undefined}
            className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
              stuck
                ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
                : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
            }`}
          >
            {stuck ? stat?.waiting : (stat?.visits ?? 0)}
          </span>
        )}
      </div>

      <div className="px-2.5 pb-2.5 pt-1 text-[13px] font-medium leading-snug text-[var(--color-ink)]">
        {sum || isEnd ? (
          <span className="block truncate">{sum || meta.label}</span>
        ) : (
          <span className="text-[12px] font-normal text-[var(--color-faint)]">Not configured</span>
        )}
      </div>

      {/* Outputs along the bottom edge: one per branch (the line carries the
          branch name), else a single out. */}
      {isEnd ? null : branches ? (
        branches.map((b, i) => (
          <Handle
            key={b.id}
            type="source"
            position={Position.Bottom}
            id={b.id}
            title={b.label}
            style={{ ...handle, left: `${((i + 1) / (branches.length + 1)) * 100}%`, background: "var(--color-accent)" }}
          />
        ))
      ) : (
        <Handle type="source" position={Position.Bottom} id="out" style={{ ...handle, background: "var(--color-accent)" }} />
      )}
    </div>
  );
}

// ────────────────────────────── deletable edge ──────────────────────────────

type EdgeCtx = { onDelete: (id: string) => void };
const edgeCtxRef: { current: EdgeCtx } = { current: { onDelete: () => {} } };

function ButtonEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  // A branch's name rides on its line, the way the flow reads top-down.
  const src = useNodesData(source);
  const branch = src ? branchesOf(src.data as HcData)?.find((b) => b.id === sourceHandleId) : undefined;
  const label = branch?.label;
  const fallback = sourceHandleId === "default";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: fallback ? "var(--color-border-strong)" : "var(--color-accent)",
          strokeWidth: selected ? 3 : 2.2,
          strokeDasharray: fallback ? "5 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan flex items-center gap-1"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          {label && (
            <span
              className={`whitespace-nowrap rounded-full border px-2 py-px text-[10.5px] font-semibold ${
                fallback
                  ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]"
                  : "border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] bg-[var(--color-success-soft)] text-[var(--color-success)]"
              }`}
            >
              {label}
            </span>
          )}
          {selected && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                edgeCtxRef.current.onDelete(id);
              }}
              className="grid h-4 w-4 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[10px] leading-none text-[var(--color-faint)] shadow-sm hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
              aria-label="Delete connection"
            >
              ×
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ────────────────────────────── graph <-> flow ──────────────────────────────

function toFlow(
  graph: FlowGraph,
  seedTrigger?: { event?: TriggerEvent; callbackId?: string; keywords?: string[] }
): { nodes: Node[]; edges: Edge[] } {
  const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const nodes: Node[] = graph.nodes.map((n, i) => {
    const data: HcData = { nodeType: n.type, ...(n.data ?? {}) };
    if (n.type === "trigger" && seedTrigger) {
      if (data.event == null) data.event = seedTrigger.event ?? "NEW_INCOMING_MESSAGE";
      if (data.callbackId == null) data.callbackId = seedTrigger.callbackId ?? "";
      if (data.keywords == null) data.keywords = seedTrigger.keywords ?? [];
    }
    return {
      id: n.id,
      type: "hc",
      position: { x: n.x ?? 80 + i * 40, y: n.y ?? 60 + i * 90 },
      data: data as Record<string, unknown>,
    };
  });
  const edges: Edge[] = graph.edges.map((e, i) => {
    const srcType = typeById.get(e.from);
    const branching = srcType === "criteria_router" || srcType === "ask_buttons";
    const sourceHandle = e.branch ?? (branching ? "default" : "out");
    return {
      id: `e${i}_${e.from}_${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle,
      targetHandle: "in",
      type: "button",
    };
  });
  // Flows saved before the top-down builder were laid out left to right; set
  // them out again once, top to bottom. Saving keeps the new positions.
  if (graph.layout !== "tb") layoutTopDown(nodes, graph.edges);
  return { nodes, edges };
}

const COL_W = 228;
const ROW_H = 110;

/**
 * Top-down positions: each step one row below its deepest parent, and each
 * branch's steps in their own column under the step that opened it.
 */
function layoutTopDown(nodes: Node[], edges: FlowGraph["edges"]) {
  if (nodes.length === 0) return;
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const root = nodes.find((n) => (n.data as HcData).nodeType === "trigger")?.id ?? nodes[0].id;

  // Rows: longest path from the trigger, ignoring loops back up.
  const depth = new Map<string, number>();
  const onPath = new Set<string>();
  const walk = (id: string, dpt: number) => {
    if (onPath.has(id) || (depth.get(id) ?? -1) >= dpt) return;
    depth.set(id, dpt);
    onPath.add(id);
    for (const c of out.get(id) ?? []) walk(c, dpt + 1);
    onPath.delete(id);
  };
  walk(root, 0);

  // Columns: the first parent to reach a step owns it; a leaf takes the next
  // free column and a parent sits over the middle of its children.
  const col = new Map<string, number>();
  let next = 0;
  const place = (id: string): number => {
    const known = col.get(id);
    if (known != null) return known;
    col.set(id, -1);
    const kids = (out.get(id) ?? []).filter((c) => !col.has(c) && (depth.get(c) ?? 0) > (depth.get(id) ?? 0));
    const xs = kids.map(place).filter((x) => x >= 0);
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : next++;
    col.set(id, x);
    return x;
  };
  place(root);

  // Steps the trigger never reaches go in rows of four underneath.
  const bottom = Math.max(0, ...depth.values()) + 2;
  let stray = 0;
  for (const n of nodes) {
    const x = col.get(n.id);
    const y = depth.get(n.id);
    if (x == null || x < 0 || y == null) {
      n.position = { x: (stray % 4) * COL_W, y: (bottom + Math.floor(stray / 4)) * ROW_H };
      stray++;
    } else {
      n.position = { x: x * COL_W, y: y * ROW_H };
    }
  }
}

function fromFlow(nodes: Node[], edges: Edge[]): FlowGraph {
  return {
    layout: "tb",
    nodes: nodes.map((n) => {
      const { nodeType, ...rest } = n.data as HcData;
      return {
        id: n.id,
        type: nodeType as NodeType,
        data: rest,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      };
    }),
    edges: edges.map((e) => {
      const sh = e.sourceHandle;
      const branch = sh && sh !== "out" ? sh : undefined;
      return { from: e.source, to: e.target, branch };
    }),
  };
}

// ────────────────────────────── palette ──────────────────────────────

const CATEGORY_NAME: Partial<Record<NodeCategory, string>> = { "Customer Interaction": "Customer" };

function NodePalette({
  onAdd,
  hasTrigger,
  disabled,
}: {
  onAdd: (t: NodeType) => void;
  hasTrigger: boolean;
  disabled: boolean;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const grouped = useMemo(() => {
    const out: Partial<Record<NodeCategory, typeof NODE_CATALOG>> = {};
    for (const entry of NODE_CATALOG) {
      if (entry.type === "trigger" && hasTrigger) continue; // one trigger per flow
      const hay = [entry.label, entry.hint, ...entry.keywords].join(" ").toLowerCase();
      if (query && !hay.includes(query)) continue;
      (out[entry.category] ??= []).push(entry);
    }
    return out;
  }, [query, hasTrigger]);

  const anyResult = CATEGORY_ORDER.some((c) => (grouped[c]?.length ?? 0) > 0);

  return (
    <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="p-3 pb-2">
        <label className="flex h-[34px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 focus-within:border-[var(--color-accent)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-faint)" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search steps"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-[var(--color-faint)]"
          />
        </label>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat];
          if (!items || items.length === 0) return null;
          return (
            <div key={cat} className="mb-3">
              <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)]">
                {CATEGORY_NAME[cat] ?? cat}
              </div>
              <div className="flex flex-col gap-0.5">
                {items.map((n) => (
                  <button
                    key={n.type}
                    type="button"
                    disabled={disabled}
                    title={disabled ? "Exit the snapshot preview to edit this flow." : n.hint}
                    onClick={() => onAdd(n.type)}
                    className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-[12px] leading-none"
                      style={{ background: `${n.color}22`, color: n.color }}
                    >
                      {n.glyph}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[var(--color-ink)]">
                        {n.label}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--color-faint)]">
                        {n.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!anyResult && (
          <p className="px-1 py-4 text-center text-[11.5px] text-[var(--color-faint)]">
            No nodes match “{q}”.
          </p>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── history dialog ──────────────────────────────

interface VersionRow {
  id: string;
  version: number;
  label: string;
  status: string | null;
  createdAt: string;
  nodeCount: number;
  graph: FlowGraph;
}

function HistoryDialog({
  automationId,
  onClose,
  onPreview,
  onRestore,
}: {
  automationId: string;
  onClose: () => void;
  onPreview: (graph: FlowGraph, version: number) => void;
  onRestore: (versionId: string) => void;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAutomationVersions(automationId).then((r) => {
      if (active) setRows(r as VersionRow[]);
    });
    return () => {
      active = false;
    };
  }, [automationId]);

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-[color-mix(in_srgb,var(--color-ink)_38%,transparent)] p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-[440px] flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h2 className="text-[13.5px] font-semibold text-[var(--color-ink)]">
              Version history
            </h2>
            <p className="text-[11px] text-[var(--color-faint)]">
              Last 10 saves · preview or restore any snapshot
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-faint)] hover:bg-[var(--color-surface-2)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-2">
          {rows == null ? (
            <p className="px-2 py-6 text-center text-[12px] text-[var(--color-faint)]">
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-[var(--color-faint)]">
              No snapshots yet. Save the flow to create one.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-[var(--color-border)] p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-medium text-[var(--color-ink)]">
                      v{r.version} · {r.label}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.status === "PUBLISHED"
                          ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                          : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
                      }`}
                    >
                      {r.status === "PUBLISHED" ? "Live" : "Draft"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-faint)]">
                    {new Date(r.createdAt).toLocaleString()} · {r.nodeCount} nodes
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPreview(r.graph, r.version)}
                      className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      title={busy === r.id ? "Restoring this snapshot…" : undefined}
                      onClick={() => {
                        setBusy(r.id);
                        onRestore(r.id);
                      }}
                      className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === r.id ? "Restoring…" : "Restore"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── zoom bar ──────────────────────────────

/** The header slots never change once the page is on screen. */
const noSubscribe = () => () => {};

function ZoomBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const btn = "grid h-8 w-8 place-items-center text-[15px] text-[var(--color-muted)] hover:text-[var(--color-ink)]";
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 shadow-[0_1px_2px_rgba(17,24,16,0.06)]">
      <button type="button" aria-label="Zoom out" onClick={() => zoomOut()} className={btn}>
        –
      </button>
      <span className="w-12 text-center text-[12px] font-semibold tabular-nums text-[var(--color-ink)]">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" onClick={() => zoomIn()} className={btn}>
        +
      </button>
      <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
      <button type="button" onClick={() => fitView({ padding: 0.15 })} className="px-2 text-[12px] font-semibold text-[var(--color-ink)]">
        Fit
      </button>
    </div>
  );
}

// ────────────────────────────── canvas ──────────────────────────────

interface CanvasProps {
  automationId: string;
  /** Shown in the publish confirmation, so it names the flow being switched on. */
  automationName?: string;
  graph: FlowGraph;
  initialEnabled: boolean;
  initialTriggerEvent?: TriggerEvent;
  initialCallbackId?: string;
  initialKeywords?: string[];
  automations: Opt[];
  campaigns: Opt[];
  /** Last-7-days run counts for the "Run data" layer (lib/automation/run-stats.ts). */
  runStats?: RunStats;
  /** Saved version; the next publish is this + 1. */
  version?: number;
}

function FlowCanvasInner(props: CanvasProps) {
  const { automationId, graph, automations, campaigns } = props;
  const nodeTypes = useMemo(() => ({ hc: HcNode }), []);
  const [runOn, setRunOn] = useState(!!props.runStats);
  const edgeTypes = useMemo(() => ({ button: ButtonEdge }), []);
  const updateNodeInternals = useUpdateNodeInternals();
  const { screenToFlowPosition } = useReactFlow();

  const seed = useMemo(
    () => ({
      event: props.initialTriggerEvent,
      callbackId: props.initialCallbackId,
      keywords: props.initialKeywords,
    }),
    [props.initialTriggerEvent, props.initialCallbackId, props.initialKeywords]
  );
  const initial = useMemo(() => toFlow(graph, seed), [graph, seed]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<"live" | "draft" | null>(null);
  const [live, setLive] = useState(props.initialEnabled);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"publish" | null>(null);
  const preSnapshot = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const readOnly = preview != null;

  // The buttons live in the page header (see automations/[id]/page.tsx).
  const slots = {
    run: useSyncExternalStore(noSubscribe, () => document.getElementById("flow-run-slot"), () => null),
    save: useSyncExternalStore(noSubscribe, () => document.getElementById("flow-save-slot"), () => null),
  };

  // What this flow will do to real people, counted off the canvas as it stands
  // right now — the publish confirmation is only useful if it describes the
  // graph being published, not the one that was loaded.
  const probes: NodeProbe[] = useMemo(
    () =>
      nodes.map((n) => {
        const hc = n.data as HcData;
        return {
          t: hc.nodeType,
          m: typeof hc.memberId === "string" ? hc.memberId : null,
          d: typeof hc.departmentId === "string" ? hc.departmentId : null,
        };
      }),
    [nodes]
  );
  const sends = useMemo(() => summariseSends(probes), [probes]);
  const gaps = useMemo(() => findFlowGaps(probes), [probes]);
  const gapCount = gaps.reduce((n, g) => n + g.count, 0);
  const stopCount = gaps
    .filter((g) => g.severity === "stops")
    .reduce((n, g) => n + g.count, 0);

  const triggerData = nodes.find(
    (n) => (n.data as HcData).nodeType === "trigger"
  )?.data as HcData | undefined;
  const sentence = triggerSentence(
    triggerData?.event ?? "NEW_INCOMING_MESSAGE",
    props.automationName ?? "this automation",
    {
      event: triggerData?.event,
      callbackId: triggerData?.callbackId,
      keywords: triggerData?.keywords,
    }
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== id));
      setSaved(null);
    },
    [setEdges]
  );
  useEffect(() => {
    edgeCtxRef.current.onDelete = deleteEdge;
  }, [deleteEdge]);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, type: "button" }, eds));
      setSaved(null);
    },
    [setEdges]
  );

  // Re-measure handles after mount / preview swap so edges resolve their
  // endpoints (handle bounds can fail to register on first mount).
  useEffect(() => {
    const ids = nodes.map((n) => n.id);
    const run = () => ids.forEach((id) => updateNodeInternals(id));
    const t1 = setTimeout(run, 80);
    const t2 = setTimeout(run, 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const d = (selectedNode?.data as HcData) ?? null;

  const patchSelected = useCallback(
    (patch: Partial<HcData>) => {
      if (!selected) return;
      setNodes((nds) =>
        nds.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n))
      );
      setSaved(null);
      // Handle count may have changed (rules / buttons) — re-measure.
      requestAnimationFrame(() => updateNodeInternals(selected));
    },
    [selected, setNodes, updateNodeInternals]
  );

  const hasTrigger = nodes.some((n) => (n.data as HcData).nodeType === "trigger");

  const addNode = useCallback(
    (t: NodeType) => {
      if (readOnly) return;
      const id = `n_${t}_${Math.random().toString(36).slice(2, 8)}`;
      const seedData: HcData = { nodeType: t };
      if (t === "trigger") seedData.event = "NEW_INCOMING_MESSAGE";
      if (t === "criteria_router")
        seedData.rules = [
          { branch: `r_${Math.random().toString(36).slice(2, 7)}`, field: "", op: "eq", value: "" },
        ];
      if (t === "ask_buttons") seedData.buttons = [];
      const pos = screenToFlowPosition({ x: 360, y: 220 });
      setNodes((nds) => [
        ...nds,
        { id, type: "hc", position: pos, data: seedData as Record<string, unknown> },
      ]);
      setSelected(id);
      setSaved(null);
    },
    [readOnly, screenToFlowPosition, setNodes]
  );

  const deleteSelected = useCallback(() => {
    if (!selected || readOnly) return;
    setNodes((nds) => nds.filter((n) => n.id !== selected));
    setEdges((eds) => eds.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
    setSaved(null);
  }, [selected, readOnly, setNodes, setEdges]);

  const duplicateSelected = useCallback(() => {
    const src = nodes.find((n) => n.id === selected);
    if (!src || readOnly) return;
    const t = (src.data as HcData).nodeType;
    const id = `n_${t}_${Math.random().toString(36).slice(2, 8)}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "hc",
        position: { x: src.position.x + 24, y: src.position.y + 24 },
        data: structuredClone(src.data),
      },
    ]);
    setSelected(id);
    setSaved(null);
  }, [nodes, selected, readOnly, setNodes]);

  const doSave = useCallback(
    (publish: boolean) => {
      const g = fromFlow(nodes, edges);
      const trig = nodes.find((n) => (n.data as HcData).nodeType === "trigger")?.data as
        | HcData
        | undefined;
      startTransition(async () => {
        await saveAutomationGraph(automationId, g, {
          publish,
          trigger: trig?.event
            ? {
                event: trig.event,
                callbackId: trig.callbackId ?? "",
                keywords: trig.keywords ?? [],
              }
            : undefined,
        });
        setLive(publish);
        setSaved(publish ? "live" : "draft");
      });
    },
    [nodes, edges, automationId]
  );

  const enterPreview = useCallback(
    (g: FlowGraph, version: number) => {
      if (preSnapshot.current == null) {
        preSnapshot.current = { nodes, edges };
      }
      const flow = toFlow(g, seed);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelected(null);
      setPreview(version);
      setHistoryOpen(false);
    },
    [nodes, edges, seed, setNodes, setEdges]
  );

  const exitPreview = useCallback(() => {
    if (preSnapshot.current) {
      setNodes(preSnapshot.current.nodes);
      setEdges(preSnapshot.current.edges);
      preSnapshot.current = null;
    }
    setPreview(null);
  }, [setNodes, setEdges]);

  const doRestore = useCallback(
    (versionId: string) => {
      startTransition(async () => {
        const res = await restoreAutomationVersion(automationId, versionId);
        if (res.ok) {
          preSnapshot.current = null;
          setPreview(null);
          setHistoryOpen(false);
          setSaved(null);
          // Reload so the restored graph becomes the fresh server truth.
          window.location.reload();
        }
      });
    },
    [automationId]
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      {!readOnly && (
        <NodePalette onAdd={addNode} hasTrigger={hasTrigger} disabled={readOnly} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {slots.run &&
          props.runStats &&
          createPortal(
            <button
              type="button"
              aria-pressed={runOn}
              onClick={() => setRunOn((v) => !v)}
              className={`flex h-[34px] items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-semibold ${
                runOn
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
              Run data
            </button>,
            slots.run
          )}
        {slots.save &&
          createPortal(
            <>
              <button
                onClick={() => setHistoryOpen(true)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                Versions
              </button>
              {/* A draft can be saved as it is; a live flow is only ever saved
                  live (saving it as a draft would switch it off — the list's
                  switch does that, on purpose). */}
              {!live && (
                <button
                  type="button"
                  onClick={() => doSave(false)}
                  disabled={pending || readOnly}
                  title={readOnly ? "You are previewing an old snapshot — exit the preview to edit and save." : undefined}
                  className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending && saved == null ? "Saving…" : "Save draft"}
                </button>
              )}
              <button
                type="button"
                // Draft → Live is the moment real customers start receiving these
                // messages. Re-saving an already-live flow does not change that,
                // so only the transition is gated.
                onClick={() => (live ? doSave(true) : setConfirm("publish"))}
                disabled={pending || readOnly}
                title={
                  readOnly
                    ? "You are previewing an old snapshot — exit the preview to edit and publish."
                    : pending
                      ? "Saving…"
                      : undefined
                }
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Saving…" : `Publish v${(props.version ?? 0) + 1}`}
              </button>
            </>,
            slots.save
          )}

        {preview != null && (
          <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-brand-soft)] px-3 py-1.5 text-[11.5px] text-[var(--color-brand-ink)]">
            <span>Previewing snapshot v{preview} (read-only).</span>
            <button
              onClick={exitPreview}
              className="rounded-md border border-[var(--color-brand)] px-2 py-0.5 text-[var(--color-brand-ink)]"
            >
              Exit preview
            </button>
          </div>
        )}


        {/* Draft → Live sends real WhatsApp messages to real customers, so the
            transition names the trigger and counts what the flow will do. */}
        <ActionConfirm
          open={confirm === "publish"}
          title="Save and publish to real customers?"
          confirmLabel="Yes, publish live"
          busyLabel="Publishing…"
          busy={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            doSave(true);
          }}
        >
          <p className="text-[var(--color-ink)]">
            This saves the flow as it is on the canvas and switches it on. From
            then it runs <strong className="font-semibold">{sentence}</strong>.
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-4">
            <li>
              {sends.messageSteps}{" "}
              {sends.messageSteps === 1 ? "step sends" : "steps send"} a WhatsApp
              message to the customer.
            </li>
            {sends.apiSteps > 0 && (
              <li>
                {sends.apiSteps}{" "}
                {sends.apiSteps === 1 ? "step calls" : "steps call"} an outside
                system (ERP / Google Script) for real.
              </li>
            )}
            <li>Nobody approves each message before it goes out.</li>
          </ul>
          {gapCount > 0 && (
            <p className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-[11.5px] text-[var(--color-faint)]">
              {gapCount} step{gapCount === 1 ? "" : "s"} on this canvas do not do
              the real thing yet
              {stopCount > 0
                ? `, and ${stopCount} of them stop the flow dead so nothing wired after them ever runs.`
                : "."}{" "}
              Click the step to read what it actually does.
            </p>
          )}
        </ActionConfirm>


        <RunCtx.Provider value={{ on: runOn, stats: props.runStats ?? null }}>
        <div className="relative min-h-0 flex-1 bg-[var(--color-canvas)]">
          {saved && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-[var(--color-ink)] px-3 py-1 text-[11.5px] font-medium text-white shadow-[var(--shadow-popover)]">
              Saved {saved === "live" ? "and published live" : "as draft"} · snapshot added to history
            </div>
          )}
          {runOn && props.runStats && (
            <div className="absolute right-4 top-4 z-10 w-[240px] rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-popover)]">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">Last 7 days</span>
                <a href="/logs" className="text-[11.5px] font-semibold text-[var(--color-accent)] hover:underline">
                  Run logs →
                </a>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  [props.runStats.started, "Started", "text-[var(--color-ink)]"],
                  [props.runStats.finished, "Finished", "text-[var(--color-success)]"],
                  [props.runStats.waiting, "Waiting", "text-[var(--color-brand)]"],
                ].map(([v, l, c]) => (
                  <div key={l as string}>
                    <div className={`text-[22px] font-medium tabular-nums ${c}`}>{v as number}</div>
                    <div className="text-[11px] text-[var(--color-faint)]">{l as string}</div>
                  </div>
                ))}
              </div>
              {props.runStats.waiting > 0 && (
                <p className="mt-2 border-t border-[var(--color-border-subtle)] pt-2 text-[11.5px] leading-snug text-[var(--color-muted)]">
                  {props.runStats.waiting} {props.runStats.waiting === 1 ? "customer is" : "customers are"} waiting on a step right now.
                </p>
              )}
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="#c3c9d3" gap={18} size={1.2} />
          </ReactFlow>
          <ZoomBar />
          <span className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11.5px] text-[var(--color-muted)] shadow-[0_1px_2px_rgba(17,24,16,0.06)]">
            <span className={`h-1.5 w-1.5 rounded-full ${gapCount ? "bg-[var(--color-warning)]" : "bg-[var(--color-success)]"}`} />
            {gapCount ? `${gapCount} step${gapCount === 1 ? "" : "s"} need checking` : "All steps configured"}
          </span>

          {historyOpen && (
            <HistoryDialog
              automationId={automationId}
              onClose={() => setHistoryOpen(false)}
              onPreview={enterPreview}
              onRestore={doRestore}
            />
          )}
        </div>
        </RunCtx.Provider>
      </div>

      {/* inspector */}
      {selectedNode && d && !readOnly && (
        <div className="flex w-[300px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-[8px] text-[13px]"
              style={{ background: `${nodeMeta(d.nodeType).color}22`, color: nodeMeta(d.nodeType).color }}
            >
              {nodeMeta(d.nodeType).glyph}
            </span>
            <span className="min-w-0">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]">
                {nodeMeta(d.nodeType).label}
              </span>
              <span className="block truncate text-[14px] font-semibold text-[var(--color-ink)]">
                {summarize(d) || nodeMeta(d.nodeType).label}
              </span>
            </span>
          </div>

          <Inspector
            d={d}
            patch={patchSelected}
            automations={automations}
            campaigns={campaigns}
          />

          </div>
          {d.nodeType !== "trigger" && (
            <div className="flex gap-2 border-t border-[var(--color-border-subtle)] p-4">
              <button
                onClick={duplicateSelected}
                className="h-9 flex-1 rounded-[8px] border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                Duplicate
              </button>
              <button
                onClick={deleteSelected}
                className="h-9 flex-1 rounded-[8px] bg-[var(--color-danger-soft)] text-[13px] font-semibold text-[var(--color-danger)] hover:brightness-95"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── inspector fields ──────────────────────────────

function Inspector({
  d,
  patch,
  automations,
  campaigns,
}: {
  d: HcData;
  patch: (p: Partial<HcData>) => void;
  automations: Opt[];
  campaigns: Opt[];
}) {
  const t = d.nodeType;

  if (t === "trigger") {
    return (
      <>
        <Field label="Event">
          <SearchableSelect
            value={d.event ?? "NEW_INCOMING_MESSAGE"}
            onChange={(v) => patch({ event: v as TriggerEvent })}
            className={inputCls}
            aria-label="Event"
            options={TRIGGER_EVENTS.map((e) => ({ value: e.value, label: e.label }))}
          />
        </Field>
        {d.event === "ACTION_CALLBACK" && (
          <Field label="Action Callback Id Matches">
            <input
              value={d.callbackId ?? ""}
              onChange={(e) => patch({ callbackId: e.target.value })}
              placeholder="e.g. To Send Delivery Date"
              className={inputCls}
            />
          </Field>
        )}
        {d.event === "ACTION_CALLBACK" && (
          <Note>
            Fires when the ERP posts this exact Action Callback Id to the webhook
            (Seampify&apos;s &ldquo;Action Callback Id Matches&rdquo;).
          </Note>
        )}
        <Note>The trigger is the flow entry — one per automation.</Note>
      </>
    );
  }

  if (t === "send_text" || t === "ai_agent_reply") {
    return (
      <Field label={t === "ai_agent_reply" ? "System prompt (optional)" : "Message"}>
        <VarTextarea value={d.message ?? ""} onChange={(v) => patch({ message: v })} />
      </Field>
    );
  }

  if (t === "collect_input") {
    return (
      <>
        <Field label="Prompt message">
          <VarTextarea value={d.message ?? ""} onChange={(v) => patch({ message: v })} />
        </Field>
        <Field label="Save answer to attribute">
          <input
            value={d.saveTo ?? ""}
            onChange={(e) => patch({ saveTo: e.target.value })}
            placeholder="e.g. delivery_address"
            className={inputCls}
          />
        </Field>
      </>
    );
  }

  if (t === "ask_buttons") {
    const buttons = d.buttons ?? [];
    return (
      <>
        <Field label="Message">
          <VarTextarea value={d.message ?? ""} onChange={(v) => patch({ message: v })} />
        </Field>
        <Field label="Buttons">
          <div className="flex flex-col gap-1.5">
            {buttons.map((b, i) => (
              <div key={b.id} className="flex gap-1">
                <input
                  value={b.label}
                  onChange={(e) => {
                    const next = buttons.slice();
                    next[i] = { ...b, label: e.target.value };
                    patch({ buttons: next });
                  }}
                  className={inputCls}
                  placeholder={`Button ${i + 1}`}
                />
                <button
                  onClick={() => patch({ buttons: buttons.filter((_, j) => j !== i) })}
                  className="shrink-0 rounded-lg border border-[var(--color-border)] px-2 text-[13px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                  aria-label="Remove button"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                patch({
                  buttons: [
                    ...buttons,
                    { id: `b_${Math.random().toString(36).slice(2, 7)}`, label: "" },
                  ],
                })
              }
              className="rounded-lg border border-dashed border-[var(--color-border-strong)] px-2 py-1 text-[11.5px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
            >
              + Add button
            </button>
          </div>
        </Field>
        <Note>Each button (and Fallback) is a separate output — connect it to the next node.</Note>
      </>
    );
  }

  if (t === "criteria_router") {
    const rules = d.rules ?? [];
    return (
      <>
        <div className="mb-1 text-[11px] text-[var(--color-muted)]">Rules</div>
        <div className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <div key={r.branch} className="rounded-lg border border-[var(--color-border)] p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-[var(--color-ink)]">
                  Rule {i + 1}
                </span>
                <button
                  onClick={() => patch({ rules: rules.filter((_, j) => j !== i) })}
                  className="text-[13px] text-[var(--color-faint)] hover:text-[var(--color-danger)]"
                  aria-label="Delete rule"
                >
                  ×
                </button>
              </div>
              <input
                value={r.field}
                onChange={(e) => {
                  const next = rules.slice();
                  next[i] = { ...r, field: e.target.value };
                  patch({ rules: next });
                }}
                placeholder="Field (attribute key / full_name / phone)"
                className={`${inputCls} mb-1`}
              />
              <SearchableSelect
                value={r.op}
                onChange={(v) => {
                  const next = rules.slice();
                  next[i] = { ...r, op: v as CriteriaRule["op"] };
                  patch({ rules: next });
                }}
                className={`${inputCls} mb-1`}
                aria-label="Operator"
                options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
              />
              {r.op !== "set" && r.op !== "unset" && (
                <input
                  value={r.value ?? ""}
                  onChange={(e) => {
                    const next = rules.slice();
                    next[i] = { ...r, value: e.target.value };
                    patch({ rules: next });
                  }}
                  placeholder="Value"
                  className={inputCls}
                />
              )}
            </div>
          ))}
          <button
            onClick={() =>
              patch({
                rules: [
                  ...rules,
                  { branch: `r_${Math.random().toString(36).slice(2, 7)}`, field: "", op: "eq", value: "" },
                ],
              })
            }
            className="rounded-lg border border-dashed border-[var(--color-border-strong)] px-2 py-1 text-[11.5px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            + Add rule
          </button>
        </div>
        <Note>Rules match top-to-bottom. The “Else” output fires when no rule matches.</Note>
      </>
    );
  }

  if (t === "set_attribute") {
    return (
      <>
        <Field label="Attribute key">
          <input value={d.key ?? ""} onChange={(e) => patch({ key: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Value">
          <input value={d.value ?? ""} onChange={(e) => patch({ value: e.target.value })} className={inputCls} />
        </Field>
      </>
    );
  }

  if (t === "add_tag" || t === "remove_tag") {
    return (
      <Field label="Tag">
        <input value={d.tag ?? ""} onChange={(e) => patch({ tag: e.target.value })} className={inputCls} />
      </Field>
    );
  }

  if (t === "jump_to_automation") {
    return (
      <Field label="Target automation">
        <SearchableSelect
          value={d.targetAutomationId ?? ""}
          onChange={(v) => {
            const opt = automations.find((a) => a.id === v);
            patch({ targetAutomationId: v, targetAutomationName: opt?.name });
          }}
          className={inputCls}
          aria-label="Target automation"
          options={[
            { value: "", label: "Select…" },
            ...automations.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </Field>
    );
  }

  if (t === "add_to_drip" || t === "remove_from_drip") {
    return (
      <Field label="Drip campaign">
        <SearchableSelect
          value={d.campaignId ?? ""}
          onChange={(v) => {
            const opt = campaigns.find((c) => c.id === v);
            patch({ campaignId: v, campaignName: opt?.name });
          }}
          className={inputCls}
          aria-label="Drip campaign"
          options={[
            { value: "", label: "Select…" },
            ...campaigns.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </Field>
    );
  }

  if (t === "opt_in" || t === "opt_out") {
    return (
      <Note>
        Marks the contact as marketing {t === "opt_in" ? "opted-in" : "opted-out"} when the
        flow reaches this node.
      </Note>
    );
  }

  if (t === "google_sheets") {
    return (
      <>
        <Field label="Spreadsheet ID">
          <input value={d.sheetId ?? ""} onChange={(e) => patch({ sheetId: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Tab name">
          <input value={d.sheetTab ?? ""} onChange={(e) => patch({ sheetTab: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Columns (comma-separated, supports {{vars}})">
          <input value={d.columns ?? ""} onChange={(e) => patch({ columns: e.target.value })} className={inputCls} />
        </Field>
        <Note>Config-only for now — the row append is not executed yet.</Note>
      </>
    );
  }

  if (t === "eval") {
    return (
      <>
        <Field label="Expression">
          <VarTextarea value={d.expression ?? ""} onChange={(v) => patch({ expression: v })} />
        </Field>
        <Note>Config-only for now — the expression is not evaluated yet.</Note>
      </>
    );
  }

  if (t === "delay") {
    return (
      <>
        <Field label="Wait amount">
          <input
            type="number"
            value={d.amount ?? ""}
            onChange={(e) => patch({ amount: Number(e.target.value) })}
            className={inputCls}
          />
        </Field>
        <Field label="Unit">
          <SearchableSelect
            value={d.unit ?? "minutes"}
            onChange={(v) => patch({ unit: v })}
            className={inputCls}
            aria-label="Unit"
            options={[
              { value: "minutes", label: "minutes" },
              { value: "hours", label: "hours" },
              { value: "days", label: "days" },
            ]}
          />
        </Field>
        <Note>
          The run pauses here and there is no scheduler to wake it up yet, so
          anything wired after this node will not run. Put Delay at the end of a
          branch until the timer is built.
        </Note>
      </>
    );
  }

  if (t === "call_rest_api") {
    return (
      <>
        <Field label="Method">
          <input value={d.method ?? "POST"} onChange={(e) => patch({ method: e.target.value })} className={inputCls} />
        </Field>
        <Field label="URL">
          <input value={d.url ?? ""} onChange={(e) => patch({ url: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Headers">
          <textarea
            value={d.headers ?? ""}
            onChange={(e) => patch({ headers: e.target.value })}
            rows={2}
            placeholder={'{"Authorization": "Bearer ..."}  or  Key: value per line'}
            className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 font-code text-[11.5px] outline-none focus:border-[var(--color-accent)]"
          />
        </Field>
        <Field label="Body">
          <VarTextarea value={d.body ?? ""} onChange={(v) => patch({ body: v })} />
        </Field>
        <Field label="Save response to attribute (optional)">
          <input
            value={d.saveResponseTo ?? ""}
            onChange={(e) => patch({ saveResponseTo: e.target.value })}
            placeholder="e.g. erp_ack"
            className={inputCls}
          />
        </Field>
        <Note>
          Called for real when the flow runs. Variables resolve in the URL, headers and body. A
          failed call is recorded in the run log and the flow continues.
        </Note>
      </>
    );
  }

  if (t === "assign") {
    return (
      <>
        <Field label="Assign to member id">
          <input value={d.memberId ?? ""} onChange={(e) => patch({ memberId: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Or department id">
          <input value={d.departmentId ?? ""} onChange={(e) => patch({ departmentId: e.target.value })} className={inputCls} />
        </Field>
      </>
    );
  }

  if (t === "set_status") {
    return (
      <Field label="Status">
        <SearchableSelect
          value={d.status ?? "OPEN"}
          onChange={(v) => patch({ status: v })}
          className={inputCls}
          aria-label="Status"
          options={[
            { value: "OPEN", label: "OPEN" },
            { value: "PENDING", label: "PENDING" },
            { value: "QUEUE", label: "QUEUE" },
            { value: "CLOSED", label: "CLOSED" },
          ]}
        />
      </Field>
    );
  }

  return <Note>This node has no configuration.</Note>;
}

// ────────────────────────────── small helpers ──────────────────────────────

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-[12px] font-semibold text-[var(--color-ink)]">{label}</label>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-[11px] leading-snug text-[var(--color-faint)]">
      {children}
    </p>
  );
}

/** Textarea with a quick {{ variable }} insert helper. */
function VarTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const VARS = ["full_name", "phone", "order_total", "ref_1", "tms_status"];
  const insert = (v: string) => {
    const el = ref.current;
    const token = `{{${v}}}`;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
  };
  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {VARS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insert(v)}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-code text-[10px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FlowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

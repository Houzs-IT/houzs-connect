"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowGraph, NodeType } from "@/lib/automation/types";
import { saveAutomationGraph } from "@/app/(app)/automations/actions";

const NODE_META: Record<string, { label: string; color: string }> = {
  trigger: { label: "Trigger", color: "#2f8a5b" },
  send_text: { label: "Send message", color: "#16695f" },
  ask_buttons: { label: "Ask buttons", color: "#a16a2e" },
  collect_input: { label: "Collect input", color: "#1b7f6b" },
  ai_agent_reply: { label: "AI agent reply", color: "#0c3f39" },
  criteria_router: { label: "Criteria router", color: "#6e4d12" },
  set_attribute: { label: "Set attribute", color: "#3d7a6f" },
  add_tag: { label: "Add tag", color: "#8a5a26" },
  remove_tag: { label: "Remove tag", color: "#b23a3a" },
  assign: { label: "Assign", color: "#2f8a5b" },
  set_status: { label: "Set status", color: "#414539" },
  call_rest_api: { label: "Call REST API", color: "#b23a3a" },
  delay: { label: "Delay", color: "#767b6e" },
  end: { label: "End", color: "#8c968a" },
};

const PALETTE: NodeType[] = [
  "send_text",
  "ask_buttons",
  "collect_input",
  "ai_agent_reply",
  "criteria_router",
  "set_attribute",
  "add_tag",
  "assign",
  "call_rest_api",
  "delay",
];

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
  rules?: { branch: string; field: string; op: string; value?: string }[];
  [k: string]: unknown;
};

function summarize(d: HcData): string {
  switch (d.nodeType) {
    case "send_text":
    case "ask_buttons":
    case "collect_input":
    case "ai_agent_reply":
      return d.message ?? "";
    case "set_attribute":
      return `${d.key ?? "?"} = ${d.value ?? ""}`;
    case "add_tag":
    case "remove_tag":
      return d.tag ?? "";
    case "criteria_router":
      return `${d.rules?.length ?? 0} rule(s)`;
    case "call_rest_api":
      return `${d.method ?? "POST"} ${d.url ?? ""}`;
    case "set_status":
      return d.status ?? "";
    default:
      return "";
  }
}

function HcNode({ data, selected }: NodeProps) {
  const d = data as HcData;
  const meta = NODE_META[d.nodeType] ?? { label: d.nodeType, color: "#767b6e" };
  const isTrigger = d.nodeType === "trigger";
  return (
    <div
      className="w-52 rounded-xl border bg-white shadow-sm"
      style={{
        borderColor: selected ? meta.color : "var(--color-border)",
        boxShadow: selected ? `0 0 0 2px ${meta.color}40` : undefined,
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div
        className="flex items-center gap-1.5 rounded-t-xl px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white"
        style={{ background: meta.color }}
      >
        {meta.label}
      </div>
      <div className="px-2.5 py-2 text-[11.5px] leading-snug text-[var(--color-ink)]">
        {summarize(d) ? (
          <span className="line-clamp-3">{summarize(d)}</span>
        ) : (
          <span className="text-[var(--color-faint)]">—</span>
        )}
        {d.buttons && d.buttons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {d.buttons.map((b) => (
              <span
                key={b.id}
                className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function FlowCanvasInner({
  automationId,
  graph,
}: {
  automationId: string;
  graph: FlowGraph;
}) {
  const nodeTypes = useMemo(() => ({ hc: HcNode }), []);
  const updateNodeInternals = useUpdateNodeInternals();

  const initialNodes: Node[] = graph.nodes.map((n, i) => ({
    id: n.id,
    type: "hc",
    position: { x: n.x ?? 60 + i * 60, y: n.y ?? 60 + i * 40 },
    data: { nodeType: n.type, ...(n.data ?? {}) },
    // Provide dimensions up front so react-flow treats nodes as measured and can
    // compute edge paths even if the client-side ResizeObserver pass stalls.
    width: 208,
    height: 84,
    measured: { width: 208, height: 84 },
    initialWidth: 208,
    initialHeight: 84,
  }));
  const initialEdges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    label: e.branch,
    animated: true,
    style: { stroke: "#c2c6bd" },
    labelStyle: { fontSize: 10, fill: "#767b6e" },
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [setEdges]
  );

  // Force react-flow to (re)measure each node's handles after mount so edges can
  // resolve their endpoints and paint (handle bounds can fail to register on first
  // mount under the dev bundler).
  useEffect(() => {
    const ids = graph.nodes.map((n) => n.id);
    const run = () => ids.forEach((id) => updateNodeInternals(id));
    const t1 = setTimeout(run, 80);
    const t2 = setTimeout(run, 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [graph, updateNodeInternals]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  const patchSelected = (patch: Partial<HcData>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n))
    );
    setSaved(false);
  };

  const addNode = (t: NodeType) => {
    const id = `n_${t}_${nodes.length + 1}_${Math.floor(nodes.length * 7 + 3)}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "hc",
        position: { x: 200, y: 80 + nds.length * 20 },
        data: { nodeType: t },
      },
    ]);
    setSaved(false);
  };

  const save = () => {
    const g = {
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
      edges: edges.map((e) => ({
        from: e.source,
        to: e.target,
        branch: (e.label as string) || undefined,
      })),
    } as unknown as FlowGraph;
    startTransition(async () => {
      await saveAutomationGraph(automationId, g);
      setSaved(true);
    });
  };

  const d = (selectedNode?.data as HcData) ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-1">
      {/* palette */}
      <div className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
          Add node
        </div>
        {PALETTE.map((t) => (
          <button
            key={t}
            onClick={() => addNode(t)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: NODE_META[t]?.color }}
            />
            {NODE_META[t]?.label ?? t}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          <div className="px-1 font-mono text-[10px] text-[var(--color-faint)]">
            {nodes.length} nodes · {edges.length} edges
          </div>
          <button
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : saved ? "Saved ✓" : "Save flow"}
          </button>
        </div>
      </div>

      <div className="h-full min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelected(n.id)}
          onPaneClick={() => setSelected(null)}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#c2c6bd" gap={18} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-[var(--color-surface-2)]" />
        </ReactFlow>
      </div>

      {/* inspector */}
      {selectedNode && d && (
        <div className="w-72 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
            {NODE_META[d.nodeType]?.label ?? d.nodeType}
          </div>

          {("message" in d || ["send_text", "ask_buttons", "collect_input", "ai_agent_reply"].includes(d.nodeType)) && (
            <Field label={d.nodeType === "ai_agent_reply" ? "System prompt (optional)" : "Message"}>
              <textarea
                value={d.message ?? ""}
                onChange={(e) => patchSelected({ message: e.target.value })}
                rows={4}
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
          )}

          {d.nodeType === "ask_buttons" && (
            <Field label="Buttons (one label per line)">
              <textarea
                value={(d.buttons ?? []).map((b) => b.label).join("\n")}
                onChange={(e) =>
                  patchSelected({
                    buttons: e.target.value
                      .split("\n")
                      .filter((s) => s.trim())
                      .map((label, i) => ({ id: (d.buttons?.[i]?.id ?? label.toLowerCase().replace(/\s+/g, "_")), label: label.trim() })),
                  })
                }
                rows={3}
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
              />
            </Field>
          )}

          {d.nodeType === "collect_input" && (
            <Field label="Save answer to attribute">
              <input
                value={(d.saveTo as string) ?? ""}
                onChange={(e) => patchSelected({ saveTo: e.target.value })}
                className={inputCls}
              />
            </Field>
          )}

          {d.nodeType === "set_attribute" && (
            <>
              <Field label="Attribute key">
                <input value={d.key ?? ""} onChange={(e) => patchSelected({ key: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Value">
                <input value={d.value ?? ""} onChange={(e) => patchSelected({ value: e.target.value })} className={inputCls} />
              </Field>
            </>
          )}

          {(d.nodeType === "add_tag" || d.nodeType === "remove_tag") && (
            <Field label="Tag">
              <input value={d.tag ?? ""} onChange={(e) => patchSelected({ tag: e.target.value })} className={inputCls} />
            </Field>
          )}

          {d.nodeType === "call_rest_api" && (
            <>
              <Field label="Method">
                <input value={d.method ?? "POST"} onChange={(e) => patchSelected({ method: e.target.value })} className={inputCls} />
              </Field>
              <Field label="URL">
                <input value={d.url ?? ""} onChange={(e) => patchSelected({ url: e.target.value })} className={inputCls} />
              </Field>
            </>
          )}

          {d.nodeType === "set_status" && (
            <Field label="Status">
              <input value={d.status ?? ""} onChange={(e) => patchSelected({ status: e.target.value })} className={inputCls} />
            </Field>
          )}

          <button
            onClick={() => {
              setNodes((nds) => nds.filter((n) => n.id !== selected));
              setEdges((eds) => eds.filter((e) => e.source !== selected && e.target !== selected));
              setSelected(null);
              setSaved(false);
            }}
            className="mt-3 w-full rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
          >
            Delete node
          </button>
        </div>
      )}
    </div>
  );
}

export function FlowCanvas(props: { automationId: string; graph: FlowGraph }) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[11px] text-[var(--color-muted)]">{label}</label>
      {children}
    </div>
  );
}

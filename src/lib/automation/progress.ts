import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation, automationRun } from "@/db/schema";
import { nodeMeta } from "./nodeCatalog";
import { asGraph, type FlowGraph, type FlowNode } from "./types";

/*
  Read-only view of a customer's automation runs, for the Service panel's
  "Automation" card and the system lines in the thread. Everything comes from
  what the engine already records — automation_run (status, cursor_node_id, the
  per-step log) plus the automation's graph — so nothing new is written while
  a flow runs.
*/

export type StepState = "done" | "current" | "todo";
export type RunStatus = "running" | "waiting" | "paused" | "completed" | "superseded" | string;

export type AutomationProgress = {
  runId: string;
  automationId: string;
  name: string;
  status: RunStatus;
  /** What a waiting run is waiting for: a button tap, a typed reply, a delay. */
  waitingFor: "button" | "text" | "delay" | null;
  steps: { id: string; label: string; state: StepState }[];
};

/** A line the thread shows between messages. Labels are chosen by the UI. */
export type AutomationEvent = {
  id: string;
  kind: "started" | "waiting_button" | "waiting_text" | "waiting_delay" | "completed" | "paused";
  name: string;
  at: Date;
};

type LogEntry = { node?: string; type?: string; awaiting?: string; at?: string };

/** How many runs back the thread looks for events. */
const EVENT_RUNS = 10;
/** How many not-yet-reached steps the card previews. */
const LOOKAHEAD = 5;

/** First sentence of a message, placeholders dropped, kept short. */
function gist(text: string): string {
  const plain = text.replace(/\{[^}]*\}/g, "…").replace(/\s+/g, " ").trim();
  const parts = plain.split(/(?<=[.?!])\s/);
  // The question is what the customer answers; a greeting says nothing.
  const first = parts.find((p) => p.endsWith("?")) ?? parts.find((p) => p.length > 12) ?? plain;
  return first.length > 34 ? `${first.slice(0, 32)}…` : first;
}

function stepLabel(node: FlowNode): string {
  const d = (node.data ?? {}) as Record<string, string | undefined> & { message?: string; tag?: string; key?: string; value?: string };
  // A step the author named keeps its name.
  if (d.label || d.title) return String(d.label ?? d.title);
  switch (node.type) {
    case "trigger":
      return "Trigger";
    case "ask_buttons":
    case "collect_input":
      return d.message ? `Ask: ${gist(d.message)}` : nodeMeta(node.type).label;
    case "send_text":
    case "send_template":
      return d.message ? `Send: ${gist(d.message)}` : "Send message";
    case "add_tag":
      return d.tag ? `Tag: ${d.tag}` : "Add tag";
    case "set_attribute":
      return d.key ? `Update ${d.key.replace(/_/g, " ")}` : "Update field";
    case "call_rest_api":
      return /erp/i.test(String(d.url ?? "")) ? "Sync back to ERP" : "Call another system";
    default:
      break;
  }
  const base = nodeMeta(node.type).label;
  const detail =
    d.message?.replace(/\{[^}]*\}/g, "…").trim() ||
    d.tag ||
    (d.key ? `${d.key}${d.value ? ` = ${d.value}` : ""}` : "");
  if (!detail) return base;
  return `${base} · ${detail.length > 42 ? `${detail.slice(0, 40)}…` : detail}`;
}

function defaultNext(graph: FlowGraph, fromId: string): string | undefined {
  const edges = graph.edges.filter((e) => e.from === fromId);
  return (edges.find((e) => e.branch == null || e.branch === "default") ?? edges[0])?.to;
}

function buildSteps(
  graph: FlowGraph,
  log: LogEntry[],
  cursor: string | null,
  finished: boolean
): AutomationProgress["steps"] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen: string[] = [];
  for (const e of log) if (e.node && byId.has(e.node) && !seen.includes(e.node)) seen.push(e.node);

  // The trigger is never logged (it only routes), so lead with it when it is
  // what led into the first logged step.
  const first = seen[0];
  const trigger = graph.nodes.find(
    (n) => n.type === "trigger" && first && graph.edges.some((e) => e.from === n.id && e.to === first)
  );
  const path = trigger ? [trigger.id, ...seen] : [...seen];

  const steps: AutomationProgress["steps"] = path.map((id) => ({
    id,
    label: stepLabel(byId.get(id)!),
    state: !finished && id === cursor ? "current" : "done",
  }));

  // Preview the road ahead along default edges, so the card shows how far
  // through the flow this customer is. Branches the customer has not chosen
  // yet are not guessed beyond the default.
  if (!finished) {
    let at = cursor ?? path[path.length - 1];
    for (let i = 0; at && i < LOOKAHEAD; i++) {
      const next = defaultNext(graph, at);
      if (!next || path.includes(next) || steps.some((s) => s.id === next)) break;
      const node = byId.get(next);
      if (!node || node.type === "end") break;
      steps.push({ id: next, label: stepLabel(node), state: "todo" });
      at = next;
    }
  }
  return steps;
}

/**
 * The customer's most relevant run: an unfinished one (running, waiting,
 * paused) if there is any, otherwise the latest run. Null when the customer
 * has never been in a flow.
 */
export async function getAutomationProgress(contactId: string): Promise<AutomationProgress | null> {
  const db = getDb();
  const runs = await db.query.automationRun.findMany({
    where: eq(automationRun.contactId, contactId),
    orderBy: desc(automationRun.updatedAt),
    limit: 5,
  });
  const run = runs.find((r) => ["running", "waiting", "paused"].includes(r.status)) ?? runs[0];
  if (!run) return null;

  const auto = await db.query.automation.findFirst({ where: eq(automation.id, run.automationId) });
  if (!auto) return null;
  const graph = asGraph(auto.graph);
  const log = (Array.isArray(run.log) ? run.log : []) as LogEntry[];
  const ctx = (run.context as { waitingFor?: string } | null) ?? {};
  const wf = ctx.waitingFor;

  return {
    runId: run.id,
    automationId: run.automationId,
    name: auto.name,
    status: run.status,
    waitingFor:
      (run.status === "waiting" || run.status === "paused") && (wf === "button" || wf === "text" || wf === "delay")
        ? wf
        : null,
    steps: buildSteps(graph, log, run.cursorNodeId, run.status === "completed"),
  };
}

/**
 * Flow milestones for the thread: started, stopped to wait for the customer,
 * finished. Limited to runs created since `since` (the oldest message on
 * screen), so they line up with the messages around them.
 */
export async function getAutomationEvents(contactId: string, since: Date): Promise<AutomationEvent[]> {
  const db = getDb();
  const runs = await db.query.automationRun.findMany({
    where: and(eq(automationRun.contactId, contactId), gte(automationRun.createdAt, since)),
    orderBy: desc(automationRun.createdAt),
    limit: EVENT_RUNS,
  });
  if (runs.length === 0) return [];

  const ids = [...new Set(runs.map((r) => r.automationId))];
  const autos = await db.query.automation.findMany({
    where: (a, { inArray }) => inArray(a.id, ids),
    columns: { id: true, name: true },
  });
  const names = new Map(autos.map((a) => [a.id, a.name]));

  const out: AutomationEvent[] = [];
  for (const r of runs) {
    const name = names.get(r.automationId) ?? "—";
    out.push({ id: `${r.id}:start`, kind: "started", name, at: r.createdAt });
    const log = (Array.isArray(r.log) ? r.log : []) as LogEntry[];
    log.forEach((e, i) => {
      if (!e.at) return;
      const kind =
        e.awaiting === "button"
          ? "waiting_button"
          : e.awaiting === "text"
            ? "waiting_text"
            : e.type === "delay"
              ? "waiting_delay"
              : null;
      if (kind) out.push({ id: `${r.id}:${i}`, kind, name, at: new Date(e.at) });
    });
    if (r.status === "completed") out.push({ id: `${r.id}:done`, kind: "completed", name, at: r.updatedAt });
    if (r.status === "paused") out.push({ id: `${r.id}:paused`, kind: "paused", name, at: r.updatedAt });
  }
  return out;
}

import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automationRun } from "@/db/schema";
import { asGraph } from "./types";

/**
 * The builder's "Run data" layer: how many customers went through each step in
 * the last seven days, and where runs are parked right now. Read from the logs
 * the engine already writes (automation_run.log / cursor_node_id) — nothing
 * extra is recorded while flows run.
 */
export type RunStats = {
  started: number;
  finished: number;
  waiting: number;
  /** node id → customers who reached it / are waiting on it now */
  perNode: Record<string, { visits: number; waiting: number }>;
};

const WINDOW_MS = 7 * 86_400_000;
const MAX_RUNS = 5000;

export async function runStats(automationId: string, graph: unknown): Promise<RunStats> {
  const db = getDb();
  const runs = await db
    .select({ status: automationRun.status, cursor: automationRun.cursorNodeId, log: automationRun.log })
    .from(automationRun)
    .where(and(eq(automationRun.automationId, automationId), gte(automationRun.createdAt, new Date(Date.now() - WINDOW_MS))))
    .limit(MAX_RUNS);

  const perNode: RunStats["perNode"] = {};
  const bump = (id: string, key: "visits" | "waiting") => {
    perNode[id] ??= { visits: 0, waiting: 0 };
    perNode[id][key]++;
  };
  let finished = 0;
  let waiting = 0;
  for (const r of runs) {
    if (r.status === "completed") finished++;
    if (r.status === "waiting") waiting++;
    const seen = new Set<string>();
    for (const e of (Array.isArray(r.log) ? r.log : []) as { node?: string }[]) {
      if (e.node && !seen.has(e.node)) {
        seen.add(e.node);
        bump(e.node, "visits");
      }
    }
    if (r.status === "waiting" && r.cursor) bump(r.cursor, "waiting");
  }
  // The trigger only routes and is never logged: every run passed through it.
  for (const n of asGraph(graph).nodes) {
    if (n.type === "trigger") perNode[n.id] = { visits: runs.length, waiting: 0 };
  }
  return { started: runs.length, finished, waiting, perNode };
}

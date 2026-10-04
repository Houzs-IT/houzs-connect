import type { FlowGraph } from "../types";

/**
 * Static checks a hand-authored flow graph must pass before it is seeded.
 *
 * houzs-connect has no test suite, and a graph is plain JSON the compiler does
 * not understand — a mistyped node id in an edge, a button with no matching
 * outgoing edge, or a router branch that goes nowhere all compile fine and then
 * silently dead-end a real customer mid-conversation. The engine (engine.ts)
 * follows edges by node id and by branch key, so these are the ways a graph can
 * be wrong without throwing. `seed-flows.ts` runs this and refuses to seed a
 * graph with any problem, so a broken flow never reaches the database.
 */
export function validateGraph(graph: FlowGraph): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
  }

  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) problems.push("no trigger node");

  // Every edge must connect two real nodes — the single most common authoring
  // slip, and the one the compiler cannot see.
  for (const e of graph.edges) {
    if (!ids.has(e.from)) problems.push(`edge from unknown node "${e.from}"`);
    if (!ids.has(e.to)) problems.push(`edge to unknown node "${e.to}"`);
  }

  const outBranches = (nodeId: string) =>
    graph.edges.filter((e) => e.from === nodeId).map((e) => e.branch ?? "default");

  for (const n of graph.nodes) {
    const branches = outBranches(n.id);

    // A button the customer can tap must lead somewhere: the engine resumes on
    // the button id, matched against an edge branch of the same value. Both
    // ask_buttons and a send_template with quick replies pause for a tap.
    if (n.type === "ask_buttons" || n.type === "send_template") {
      const buttons = n.data?.buttons ?? [];
      if (n.type === "ask_buttons" && buttons.length === 0) {
        problems.push(`ask_buttons "${n.id}" has no buttons`);
      }
      for (const b of buttons) {
        if (!branches.includes(b.id)) {
          problems.push(`${n.type} "${n.id}" button "${b.id}" has no outgoing edge`);
        }
      }
    }

    // A template node whose template was never named sends free text, which Meta
    // refuses for a business-initiated open — catch it at authoring time.
    if (n.type === "send_template" && !n.data?.templateName) {
      problems.push(`send_template "${n.id}" has no templateName`);
    }

    // Every router rule branch must have an edge, and a router needs a default
    // edge so a contact matching no rule still goes somewhere.
    if (n.type === "criteria_router") {
      const rules = n.data?.rules ?? [];
      for (const r of rules) {
        if (!branches.includes(r.branch)) {
          problems.push(`criteria_router "${n.id}" rule branch "${r.branch}" has no outgoing edge`);
        }
      }
      if (!branches.includes("default")) {
        problems.push(`criteria_router "${n.id}" has no default edge`);
      }
    }

    // A send_form node whose form was never wired sends nothing; catch the empty
    // id at authoring time rather than discovering it as a skipped step in prod.
    if (n.type === "send_form" && !n.data?.formId) {
      problems.push(`send_form "${n.id}" has no formId`);
    }
  }

  return problems;
}

// Automation graph shape. Stored as Automation.graph (JSON) and interpreted by the engine.

export type NodeType =
  | "trigger"
  | "send_text"
  | "ask_buttons" // interactive buttons; run pauses awaiting a tap
  | "collect_input" // pauses awaiting a free-text reply, saves to an attribute
  | "ai_agent_reply" // generate + send an AI reply to the last customer message
  | "criteria_router" // branch on a contact attribute
  | "set_attribute"
  | "add_tag"
  | "remove_tag"
  | "assign"
  | "set_status"
  | "delay"
  | "call_rest_api"
  | "end";

export interface FlowButton {
  id: string;
  label: string;
}

export interface CriteriaRule {
  branch: string; // edge branch key to follow when this rule matches
  field: string; // contact attribute key (or "full_name", "phone")
  op: "eq" | "neq" | "set" | "unset" | "contains";
  value?: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  // free-form per node type; see engine.ts for what each reads
  data?: {
    message?: string;
    buttons?: FlowButton[];
    saveTo?: string;
    key?: string;
    value?: string;
    tag?: string;
    memberId?: string;
    departmentId?: string;
    status?: string;
    unit?: "minutes" | "hours" | "days";
    amount?: number;
    method?: string;
    url?: string;
    rules?: CriteriaRule[];
    timeoutMinutes?: number;
    [k: string]: unknown;
  };
  // canvas position (builder)
  x?: number;
  y?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  branch?: string; // for ask_buttons (button id) / criteria_router (rule branch) / "default"
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function asGraph(g: unknown): FlowGraph {
  const obj = (typeof g === "string" ? safeParse(g) : g) as Partial<FlowGraph> | null;
  return {
    nodes: Array.isArray(obj?.nodes) ? (obj!.nodes as FlowNode[]) : [],
    edges: Array.isArray(obj?.edges) ? (obj!.edges as FlowEdge[]) : [],
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Automation graph shape. Stored as Automation.graph (JSON) and interpreted by the engine.

export type NodeType =
  | "trigger"
  | "send_text"
  | "ask_buttons" // interactive buttons; run pauses awaiting a tap
  | "collect_input" // pauses awaiting a free-text reply, saves to an attribute
  | "send_form" // send a Meta WhatsApp Flow form; pauses awaiting the submission
  | "ai_agent_reply" // generate + send an AI reply to the last customer message
  | "criteria_router" // branch on a contact attribute
  | "jump_to_automation" // hand the contact off to another automation
  | "set_attribute"
  | "add_tag"
  | "remove_tag"
  | "add_to_drip" // enrol the contact into a drip campaign
  | "remove_from_drip" // remove the contact from a drip campaign
  | "opt_in" // marketing opt-in
  | "opt_out" // marketing opt-out
  | "google_sheets" // append a row to a Google Sheet (config-only stub)
  | "eval" // evaluate a JS expression (config-only stub)
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
  branch: string; // edge branch key to follow when this rule matches (stable id)
  field: string; // contact attribute key (or "full_name", "phone")
  op: "eq" | "neq" | "set" | "unset" | "contains";
  value?: string;
}

/**
 * Trigger events surfaced in the builder's Trigger node. The engine dispatches on
 * Automation.triggerType (see lib/automation/dispatch.ts); TRIGGER_EVENT_TO_TYPE
 * maps a builder event to the column value.
 *
 * ACTION_CALLBACK is now first-class: it maps to its own triggerType so the ERP
 * webhook can fire an automation whose configured `callbackId` equals the incoming
 * "Action Callback Id" (Seampify's contract — the Sheet/ERP POSTs that string to
 * /api/webhooks/erp). It is NOT remapped to NEW_INCOMING_MESSAGE, which would make
 * it fire on every inbound message instead of only on the matching callback.
 */
export type TriggerEvent =
  | "NEW_INCOMING_MESSAGE"
  | "ACTION_CALLBACK"
  | "WEBHOOK"
  | "TAG_ADDED";

export const TRIGGER_EVENT_TO_TYPE: Record<TriggerEvent, string> = {
  NEW_INCOMING_MESSAGE: "NEW_INCOMING_MESSAGE",
  ACTION_CALLBACK: "ACTION_CALLBACK",
  WEBHOOK: "WEBHOOK",
  TAG_ADDED: "TAG_ADDED",
};

export interface TriggerData {
  event?: TriggerEvent;
  callbackId?: string; // ACTION_CALLBACK: the exact Action Callback Id to match
  keywords?: string[]; // ACTION_CALLBACK: legacy list of callback ids / keywords (fallback match)
  [k: string]: unknown;
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
    unit?: string;
    amount?: number;
    // call_rest_api
    method?: string;
    url?: string;
    body?: string;
    headers?: string; // JSON object text, or "Key: value" lines
    saveResponseTo?: string; // contact attribute to store the response body in
    rules?: CriteriaRule[];
    timeoutMinutes?: number;
    // trigger
    event?: TriggerEvent;
    callbackId?: string;
    keywords?: string[];
    // jump_to_automation
    targetAutomationId?: string;
    targetAutomationName?: string;
    // drip
    campaignId?: string;
    campaignName?: string;
    // ai_agent_reply
    agentId?: string;
    // google_sheets
    sheetId?: string;
    sheetTab?: string;
    columns?: string;
    // eval
    expression?: string;
    // send_form — formId is a houzs-connect form.id (carries the published Meta
    // flow id); flowCta is the button label that opens the form.
    formId?: string;
    flowCta?: string;
    flowScreen?: string;
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

/** A saved snapshot of an automation's graph (version history). */
export interface AutomationVersionSnapshot {
  id: string;
  version: number;
  label: string;
  status: string | null;
  graph: FlowGraph;
  triggerType: string | null;
  createdAt: string;
  nodeCount: number;
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

import type { NodeType } from "./types";

/**
 * The builder's node catalogue — the single source of truth for the searchable
 * palette (grouped by Seampify's category headers) and for how each node renders
 * on the canvas (label, tile colour, icon glyph). Engine execution lives in
 * lib/automation/engine.ts; some nodes are config-only stubs (see `stub`).
 */

export type NodeCategory =
  | "Starting Point"
  | "Workflow"
  | "Messaging"
  | "Customer Interaction"
  | "Advanced";

export interface NodeCatalogEntry {
  type: NodeType;
  label: string;
  category: NodeCategory;
  color: string;
  /** single-glyph icon drawn in the node tile / palette chip. */
  glyph: string;
  /** extra search terms so the palette filter matches Seampify's wording. */
  keywords: string[];
  /** one-line hint shown under the label in the palette. */
  hint: string;
  /** true = engine execution is a config-only stub (logged, then continues). */
  stub?: boolean;
  /** true = branches to multiple outputs (per-rule / per-button source handles). */
  branching?: boolean;
}

export const CATEGORY_ORDER: NodeCategory[] = [
  "Starting Point",
  "Workflow",
  "Messaging",
  "Customer Interaction",
  "Advanced",
];

export const NODE_CATALOG: NodeCatalogEntry[] = [
  {
    type: "trigger",
    label: "Trigger",
    category: "Starting Point",
    color: "#2f8a5b",
    glyph: "◆",
    keywords: ["start", "entry", "event", "new message", "webhook", "tag added", "action callback"],
    hint: "Flow entry — one per automation",
  },
  // ── Workflow ──
  {
    type: "criteria_router",
    label: "Criteria Router",
    category: "Workflow",
    color: "#6e4d12",
    glyph: "⋔",
    keywords: ["branch", "condition", "if", "rule", "router", "switch"],
    hint: "Branch on field / operator / value",
    branching: true,
  },
  {
    type: "jump_to_automation",
    label: "Jump To Automation",
    category: "Workflow",
    color: "#414539",
    glyph: "↪",
    keywords: ["goto", "handoff", "chain", "another automation"],
    hint: "Hand the contact to another automation",
    stub: true,
  },
  {
    type: "delay",
    label: "Delay Execution",
    category: "Workflow",
    color: "#767b6e",
    glyph: "◷",
    keywords: ["wait", "pause", "sleep", "timer"],
    hint: "Wait a duration before continuing",
  },
  // ── Messaging ──
  {
    type: "send_text",
    label: "Auto Reply Template Message",
    category: "Messaging",
    color: "#16695f",
    glyph: "✎",
    keywords: ["message", "send", "text", "template", "whatsapp"],
    hint: "Send a WhatsApp message with {{variables}}",
  },
  {
    type: "ask_buttons",
    label: "Auto Reply Buttons / Options",
    category: "Messaging",
    color: "#a16a2e",
    glyph: "▣",
    keywords: ["buttons", "options", "products", "interactive", "quick reply"],
    hint: "Send interactive buttons; wait for a tap",
    branching: true,
  },
  {
    type: "collect_input",
    label: "Collect User Input",
    category: "Messaging",
    color: "#1b7f6b",
    glyph: "⌨",
    keywords: ["ask", "prompt", "capture", "input", "reply", "question"],
    hint: "Ask, then save the reply to an attribute",
  },
  {
    type: "ai_agent_reply",
    label: "AI Agent Reply",
    category: "Messaging",
    color: "#0c3f39",
    glyph: "✦",
    keywords: ["ai", "agent", "gpt", "generate", "smart reply"],
    hint: "Generate + send an AI reply",
  },
  // ── Customer Interaction ──
  {
    type: "add_to_drip",
    label: "Add To Drip Campaign",
    category: "Customer Interaction",
    color: "#2f8a5b",
    glyph: "＋",
    keywords: ["drip", "campaign", "enrol", "sequence", "nurture"],
    hint: "Enrol the contact into a drip campaign",
    stub: true,
  },
  {
    type: "remove_from_drip",
    label: "Remove From Drip Campaign",
    category: "Customer Interaction",
    color: "#b23a3a",
    glyph: "－",
    keywords: ["drip", "campaign", "unsubscribe", "remove", "sequence"],
    hint: "Remove the contact from a drip campaign",
    stub: true,
  },
  {
    type: "set_attribute",
    label: "Set Contact Attribute",
    category: "Customer Interaction",
    color: "#3d7a6f",
    glyph: "≔",
    keywords: ["attribute", "field", "set", "key", "value", "variable"],
    hint: "Write key = value onto the contact",
  },
  {
    type: "add_tag",
    label: "Add Tag",
    category: "Customer Interaction",
    color: "#8a5a26",
    glyph: "#",
    keywords: ["tag", "label", "add", "tagging"],
    hint: "Add a tag to the contact",
  },
  {
    type: "remove_tag",
    label: "Remove Tag",
    category: "Customer Interaction",
    color: "#b23a3a",
    glyph: "#",
    keywords: ["tag", "label", "remove", "tagging"],
    hint: "Remove a tag from the contact",
  },
  {
    type: "opt_in",
    label: "Opt In",
    category: "Customer Interaction",
    color: "#2f8a5b",
    glyph: "✓",
    keywords: ["opt in", "subscribe", "marketing", "consent"],
    hint: "Mark the contact as marketing opted-in",
  },
  {
    type: "opt_out",
    label: "Opt Out",
    category: "Customer Interaction",
    color: "#6e4d12",
    glyph: "⦸",
    keywords: ["opt out", "unsubscribe", "marketing", "stop"],
    hint: "Mark the contact as marketing opted-out",
  },
  {
    type: "google_sheets",
    label: "Google Sheets",
    category: "Customer Interaction",
    color: "#414539",
    glyph: "▤",
    keywords: ["google", "sheets", "spreadsheet", "append", "row", "log"],
    hint: "Append a row to a Google Sheet",
    stub: true,
  },
  {
    type: "eval",
    label: "Eval",
    category: "Customer Interaction",
    color: "#414539",
    glyph: "∑",
    keywords: ["eval", "expression", "compute", "script", "javascript"],
    hint: "Evaluate an expression",
    stub: true,
  },
  // ── Advanced (Connect / ERP-specific) ──
  {
    type: "assign",
    label: "Assign Conversation",
    category: "Advanced",
    color: "#2f8a5b",
    glyph: "☍",
    keywords: ["assign", "agent", "department", "route", "owner"],
    hint: "Assign the conversation to an agent / team",
  },
  {
    type: "set_status",
    label: "Set Conversation Status",
    category: "Advanced",
    color: "#414539",
    glyph: "◧",
    keywords: ["status", "open", "close", "queue", "pending"],
    hint: "Open / close / queue the conversation",
  },
  {
    type: "call_rest_api",
    label: "Call REST API",
    category: "Advanced",
    color: "#b23a3a",
    glyph: "⇄",
    keywords: ["api", "http", "webhook", "rest", "erp", "call"],
    hint: "Call an ERP / external endpoint",
  },
  {
    type: "end",
    label: "End",
    category: "Advanced",
    color: "#8c968a",
    glyph: "■",
    keywords: ["end", "stop", "finish", "terminate"],
    hint: "End the flow",
  },
];

export const NODE_BY_TYPE: Record<string, NodeCatalogEntry> = Object.fromEntries(
  NODE_CATALOG.map((n) => [n.type, n])
);

export function nodeMeta(type: string): NodeCatalogEntry {
  return (
    NODE_BY_TYPE[type] ?? {
      type: type as NodeType,
      label: type,
      category: "Advanced",
      color: "#767b6e",
      glyph: "•",
      keywords: [],
      hint: "",
    }
  );
}

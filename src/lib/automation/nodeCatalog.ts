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
    label: "Router",
    category: "Workflow",
    color: "#6e4d12",
    glyph: "⋔",
    keywords: ["branch", "condition", "if", "rule", "router", "switch"],
    hint: "Branch on a field",
    branching: true,
  },
  {
    type: "jump_to_automation",
    label: "Jump to automation",
    category: "Workflow",
    color: "#414539",
    glyph: "↪",
    keywords: ["goto", "handoff", "chain", "another automation"],
    hint: "Hand over to another automation",
  },
  {
    type: "delay",
    label: "Delay",
    category: "Workflow",
    color: "#767b6e",
    glyph: "◷",
    keywords: ["wait", "pause", "sleep", "timer"],
    hint: "Wait before continuing",
  },
  // ── Messaging ──
  {
    type: "send_text",
    label: "Send message",
    category: "Messaging",
    color: "#16695f",
    glyph: "✎",
    keywords: ["message", "send", "text", "template", "whatsapp"],
    hint: "WhatsApp message with variables",
  },
  {
    type: "ask_buttons",
    label: "Buttons",
    category: "Messaging",
    color: "#a16a2e",
    glyph: "▣",
    keywords: ["buttons", "options", "products", "interactive", "quick reply"],
    hint: "Buttons, wait for a tap",
    branching: true,
  },
  {
    type: "collect_input",
    label: "Collect input",
    category: "Messaging",
    color: "#1b7f6b",
    glyph: "⌨",
    keywords: ["ask", "prompt", "capture", "input", "reply", "question"],
    hint: "Save the reply to a field",
  },
  {
    type: "send_form",
    label: "Send form",
    category: "Messaging",
    color: "#2a6f97",
    glyph: "▦",
    keywords: ["form", "flow", "collect", "fields", "property details", "whatsapp flow"],
    hint: "WhatsApp Flow form, wait for it",
  },
  {
    type: "send_template",
    label: "Send template",
    category: "Messaging",
    color: "#0f766e",
    glyph: "❏",
    keywords: ["template", "approved", "hsm", "open", "business initiated", "whatsapp template"],
    hint: "Approved template, opens a chat",
    branching: true,
  },
  {
    type: "ai_agent_reply",
    label: "AI reply",
    category: "Messaging",
    color: "#0c3f39",
    glyph: "✦",
    keywords: ["ai", "agent", "gpt", "generate", "smart reply"],
    hint: "Generate and send a reply",
  },
  // ── Customer Interaction ──
  {
    type: "add_to_drip",
    label: "Add to drip",
    category: "Customer Interaction",
    color: "#2f8a5b",
    glyph: "＋",
    keywords: ["drip", "campaign", "enrol", "sequence", "nurture"],
    hint: "Enrol in a drip campaign",
    stub: true,
  },
  {
    type: "remove_from_drip",
    label: "Remove from drip",
    category: "Customer Interaction",
    color: "#b23a3a",
    glyph: "－",
    keywords: ["drip", "campaign", "unsubscribe", "remove", "sequence"],
    hint: "Take out of a drip campaign",
    stub: true,
  },
  {
    type: "set_attribute",
    label: "Set attribute",
    category: "Customer Interaction",
    color: "#3d7a6f",
    glyph: "≔",
    keywords: ["attribute", "field", "set", "key", "value", "variable"],
    hint: "Write a field on the contact",
  },
  {
    type: "add_tag",
    label: "Add tag",
    category: "Customer Interaction",
    color: "#8a5a26",
    glyph: "#",
    keywords: ["tag", "label", "add", "tagging"],
    hint: "Add a tag",
  },
  {
    type: "remove_tag",
    label: "Remove tag",
    category: "Customer Interaction",
    color: "#b23a3a",
    glyph: "#",
    keywords: ["tag", "label", "remove", "tagging"],
    hint: "Remove a tag",
  },
  {
    type: "opt_in",
    label: "Opt in",
    category: "Customer Interaction",
    color: "#2f8a5b",
    glyph: "✓",
    keywords: ["opt in", "subscribe", "marketing", "consent"],
    hint: "Marketing opted-in",
  },
  {
    type: "opt_out",
    label: "Opt out",
    category: "Customer Interaction",
    color: "#6e4d12",
    glyph: "⦸",
    keywords: ["opt out", "unsubscribe", "marketing", "stop"],
    hint: "Marketing opted-out",
  },
  {
    type: "google_sheets",
    label: "Google Sheets",
    category: "Customer Interaction",
    color: "#414539",
    glyph: "▤",
    keywords: ["google", "sheets", "spreadsheet", "append", "row", "log"],
    hint: "Append a row to a sheet",
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
    label: "Assign",
    category: "Advanced",
    color: "#2f8a5b",
    glyph: "☍",
    keywords: ["assign", "agent", "department", "route", "owner"],
    hint: "Agent or department",
  },
  {
    type: "set_status",
    label: "Set status",
    category: "Advanced",
    color: "#414539",
    glyph: "◧",
    keywords: ["status", "open", "close", "queue", "pending"],
    hint: "Open / close / queue",
  },
  {
    type: "call_rest_api",
    label: "REST API",
    category: "Advanced",
    color: "#b23a3a",
    glyph: "⇄",
    keywords: ["api", "http", "webhook", "rest", "erp", "call"],
    hint: "Call the ERP",
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

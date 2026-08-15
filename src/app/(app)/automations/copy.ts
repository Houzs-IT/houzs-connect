/**
 * Plain-language copy + flow analysis for the Automations pages.
 *
 * Deliberately NOT a "use server" module: it exports constants and pure
 * functions, so it can be imported by server components, client components and
 * the server-action file alike.
 *
 * Two jobs:
 *
 *  1. Turn stored values (trigger types, DRAFT/PUBLISHED, the importer's
 *     description string) into words an operator can act on. The owner should
 *     never be shown `ACTION_CALLBACK` or `PUBLISHED`.
 *
 *  2. Explain "Approximations: N". Every imported automation carries a
 *     description like "Imported from Seampify (184 nodes / 276 edges). Draft
 *     for owner review. Approximations: 12." — a number the UI never expanded,
 *     while asking the owner to review it. `findFlowGaps` recomputes the part
 *     of that number that is still visible in the saved graph, node type by
 *     node type, straight from what `lib/automation/engine.ts` actually does.
 */

import { nodeMeta } from "@/lib/automation/nodeCatalog";

// ── Trigger wording ────────────────────────────────────────────────

/** Short label for a trigger type — used in lists and pills. */
export const TRIGGER_LABEL: Record<string, string> = {
  NEW_INCOMING_MESSAGE: "New incoming message",
  WEBHOOK: "Webhook received",
  ACTION_CALLBACK: "Action callback id matches",
  TAG_ADDED: "When a tag is added",
  PAYMENT_RECEIVED: "Payment received",
  DRIVER_EVENT: "Driver event",
  CONTACT_FIELD_UPDATED: "Contact field updated",
};

export interface TriggerConfigShape {
  event?: string;
  callbackId?: string;
  keywords?: string[];
}

/**
 * A full sentence describing exactly when this automation fires, for the
 * publish confirmation. Publishing sends real WhatsApp messages to real
 * customers, so the confirm has to say what pulls the trigger — not just
 * "are you sure?".
 */
export function triggerSentence(
  triggerType: string,
  name: string,
  cfg?: TriggerConfigShape | null
): string {
  const callbackId = cfg?.callbackId?.trim() ?? "";
  const keywords = (cfg?.keywords ?? []).filter(Boolean);

  switch (triggerType) {
    case "NEW_INCOMING_MESSAGE":
      return "every time a customer sends a message to this WhatsApp number";
    case "ACTION_CALLBACK":
      return callbackId
        ? `every time your ERP or Google Sheet sends the action “${callbackId}”`
        : keywords.length > 0
          ? `every time your ERP or Google Sheet sends one of these actions: ${keywords.join(", ")}`
          : "every time your ERP or Google Sheet sends an action — but no action id is filled in yet, so it will never fire";
    case "WEBHOOK":
      return `every time your ERP or Google Sheet posts to Connect asking for “${name}”`;
    case "TAG_ADDED":
      return keywords.length > 0
        ? `every time one of these tags is added to a contact: ${keywords.join(", ")}`
        : "every time ANY tag is added to a contact — by a person in the inbox, or by another automation";
    case "DRIVER_EVENT":
      return "every time a driver marks a delivery as on the way, arrived, delivered or failed";
    case "PAYMENT_RECEIVED":
      return "every time a customer sends a payment receipt into the chat";
    case "CONTACT_FIELD_UPDATED":
      return "every time a contact's details are changed";
    default:
      return `on the “${TRIGGER_LABEL[triggerType] ?? triggerType}” event`;
  }
}

/** The trigger types the builder offers when creating an automation. */
export const CREATABLE_TRIGGERS: { value: string; label: string; hint: string }[] = [
  {
    value: "NEW_INCOMING_MESSAGE",
    label: "A customer messages us",
    hint: "Runs whenever someone writes to this WhatsApp number.",
  },
  {
    value: "ACTION_CALLBACK",
    label: "The ERP sends an action",
    hint: "Runs when the ERP / Sheet sends one exact action id, e.g. “To Send Delivery Date”.",
  },
  {
    value: "WEBHOOK",
    label: "The ERP calls this automation by name",
    hint: "Runs when the ERP posts to Connect asking for this automation.",
  },
  {
    value: "TAG_ADDED",
    label: "A tag is added to a contact",
    hint: "Runs when someone tags a contact in the inbox, or another flow tags them.",
  },
];

// ── Status wording ─────────────────────────────────────────────────

/** DRAFT/PUBLISHED + enabled → what the operator sees. */
export function statusLabel(enabled: boolean): string {
  return enabled ? "Live" : "Draft";
}

export function statusExplainer(enabled: boolean): string {
  return enabled
    ? "Running for real. Customers receive its messages."
    : "Saved but switched off. It never runs and no customer sees it.";
}

// ── The importer's description ─────────────────────────────────────

export interface ImportNote {
  /** The number the importer wrote into the description, if present. */
  approximations: number | null;
  /** Anything in the description that is not the boilerplate import sentence. */
  rest: string;
  /** True when this row's description is the Seampify import boilerplate. */
  imported: boolean;
}

const IMPORT_RE =
  /Imported from Seampify\s*\((\d+)\s*nodes?\s*\/\s*(\d+)\s*edges?\)\.?\s*(?:Draft for owner review\.?)?\s*(?:Approximations:\s*(\d+)\.?)?/i;

/**
 * Pull the machine-written bits out of `automation.description` so the card can
 * render a sentence instead of a log line. Anything the owner typed himself is
 * preserved in `rest` and shown as-is.
 */
export function parseImportNote(description?: string | null): ImportNote {
  const text = (description ?? "").trim();
  if (!text) return { approximations: null, rest: "", imported: false };
  const m = text.match(IMPORT_RE);
  if (!m) return { approximations: null, rest: text, imported: false };
  return {
    approximations: m[3] != null ? Number(m[3]) : null,
    rest: text.replace(IMPORT_RE, "").trim(),
    imported: true,
  };
}

// ── Flow gap analysis ──────────────────────────────────────────────

/**
 * One node, reduced to just the fields the gap analysis needs. The list page
 * asks Postgres for this shape instead of the whole graph — the largest live
 * flow is 184 nodes and the list renders every automation at once.
 */
export interface NodeProbe {
  /** node type */
  t?: string | null;
  /** assign node: member target */
  m?: string | null;
  /** assign node: department target */
  d?: string | null;
}

export type GapSeverity = "stops" | "silent" | "partial";

export interface FlowGap {
  /** node type it came from — also the React key */
  key: string;
  /** how many nodes of this kind are in the flow */
  count: number;
  severity: GapSeverity;
  /** what the step is called in the builder */
  title: string;
  /** what it really does when the flow runs */
  detail: string;
}

export const SEVERITY_LABEL: Record<GapSeverity, string> = {
  stops: "Stops the flow",
  silent: "Does nothing",
  partial: "Does only part of it",
};

/**
 * What each unfinished node type actually does at runtime.
 *
 * Every line here is a statement about `lib/automation/engine.ts`, not a guess:
 * `google_sheets`, `eval` and `jump_to_automation` fall through one shared
 * `logStep(... stub: true)` branch and continue; the drip nodes only write a
 * `drip_campaign` contact attribute; `delay` returns `{ pause: "delay" }` and
 * nothing in the codebase ever resumes it.
 */
const GAP_BY_TYPE: Record<string, { severity: GapSeverity; detail: string }> = {
  delay: {
    severity: "stops",
    detail:
      "The flow stops at this wait and nothing ever starts it again — there is no timer in Connect that wakes a waiting flow up. Every customer who reaches this step is left here, and nothing after it runs. Only a customer reply can move a flow on today.",
  },
  google_sheets: {
    severity: "silent",
    detail:
      "Nothing is written to the spreadsheet. The step is recorded in the run log and the flow carries on to the next step. Sheet writes that go through a “Call REST API” step do work.",
  },
  eval: {
    severity: "silent",
    detail:
      "The expression is not calculated. The step is recorded in the run log and the flow carries on to the next step.",
  },
  jump_to_automation: {
    severity: "silent",
    detail:
      "The other automation is not started. The flow carries on to whatever this step is connected to instead.",
  },
  add_to_drip: {
    severity: "partial",
    detail:
      "Nobody is enrolled into a campaign. It writes the campaign name onto the contact as a note (drip_campaign) so later steps can check it, and that is all.",
  },
  remove_from_drip: {
    severity: "partial",
    detail:
      "Nobody is removed from a campaign. It clears the contact's drip_campaign note, and that is all.",
  },
};

/**
 * Which steps in this flow do not do the real thing. Computed from the saved
 * graph, so it stays true after the owner edits the flow — unlike the frozen
 * "Approximations: N" number the importer wrote into the description.
 */
export function findFlowGaps(probes: NodeProbe[]): FlowGap[] {
  const counts = new Map<string, number>();
  for (const p of probes) {
    const t = p?.t;
    if (!t) continue;
    if (t === "assign") {
      // An assign node runs for real — but only if it has somewhere to send the
      // conversation. The Seampify import could not map department ids, so the
      // imported ones came across with both targets empty.
      const hasTarget = Boolean(p.m?.trim()) || Boolean(p.d?.trim());
      if (!hasTarget) counts.set("assign", (counts.get("assign") ?? 0) + 1);
      continue;
    }
    if (GAP_BY_TYPE[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  const gaps: FlowGap[] = [];
  for (const [type, count] of counts) {
    if (type === "assign") {
      gaps.push({
        key: "assign",
        count,
        severity: "partial",
        title: "Assign conversation — nobody chosen",
        detail:
          "No agent and no team is filled in on this step, so the conversation is not handed to anyone. Open the step and pick a person or a department.",
      });
      continue;
    }
    const g = GAP_BY_TYPE[type];
    gaps.push({
      key: type,
      count,
      severity: g.severity,
      title: nodeMeta(type).label,
      detail: g.detail,
    });
  }

  // Hard stops first, then silent no-ops, then partial ones.
  const order: Record<GapSeverity, number> = { stops: 0, silent: 1, partial: 2 };
  return gaps.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.count - a.count
  );
}

/**
 * The part of "Approximations: N" that cannot be recovered from the graph.
 *
 * The importer rewrote WhatsApp template messages and WhatsApp Form steps as
 * ordinary text messages, and those saved as plain `send_text` nodes — there is
 * no marker left to count them by. Saying so is the honest half of explaining
 * the number.
 */
export const APPROXIMATION_FOOTNOTE =
  "The import also rewrote WhatsApp template messages and in-chat form steps as ordinary text messages. Those look exactly like a normal message step now, so they cannot be listed here — open the flow and read the wording of each message before going live.";

// ── Counting for the publish confirmation ──────────────────────────

export interface SendSummary {
  /** steps that send the customer a WhatsApp message */
  messageSteps: number;
  /** steps that call an outside system for real */
  apiSteps: number;
}

const MESSAGE_TYPES = new Set([
  "send_text",
  "ask_buttons",
  "collect_input",
  "ai_agent_reply",
]);

/** How much this flow will do to a customer, for the publish confirmation. */
export function summariseSends(probes: NodeProbe[]): SendSummary {
  let messageSteps = 0;
  let apiSteps = 0;
  for (const p of probes) {
    const t = p?.t;
    if (!t) continue;
    if (MESSAGE_TYPES.has(t)) messageSteps++;
    else if (t === "call_rest_api") apiSteps++;
  }
  return { messageSteps, apiSteps };
}

import type { SeedFlow } from "./types";

/**
 * Replied Check — the unresponsive-customer nudge (decision B).
 *
 * Seampify's "has not replied" message: the ERP (or a staff action) fires this
 * when a customer has gone quiet; we send one nudge and hand the conversation to
 * an agent. The engine has no timer that could wake a delayed run (a Delay pause
 * is never resumed), so this is a plain triggered flow, not a wait — the "no
 * reply after N hours" decision stays on the ERP / staff side.
 */

const NUDGE = `Hi {full_name},

It seems like you have not given a response yet.

To ensure nothing is missed. We will assign an agent to you.`;

export const repliedCheckFlow: SeedFlow = {
  key: "replied_check",
  name: "Replied Check",
  description:
    "Unresponsive-customer nudge: message the customer, queue the conversation for an agent, tag it.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "no_reply" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 120 },
      { id: "msg", type: "send_text", x: 240, y: 120, data: { message: NUDGE } },
      { id: "queue", type: "set_status", x: 460, y: 120, data: { status: "QUEUE" } },
      { id: "tag", type: "add_tag", x: 680, y: 120, data: { tag: "unresponsive" } },
      { id: "done", type: "end", x: 900, y: 120, data: {} },
    ],
    edges: [
      { from: "trigger", to: "msg" },
      { from: "msg", to: "queue" },
      { from: "queue", to: "tag" },
      { from: "tag", to: "done" },
    ],
  }),
};

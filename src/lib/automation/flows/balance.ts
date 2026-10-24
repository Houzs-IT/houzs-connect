import type { SeedFlow } from "./types";

/**
 * Balance Reminder — a standalone outstanding-balance nudge (decision B).
 *
 * The ERP fires this by name (trigger WEBHOOK) to chase an unpaid balance on its
 * own, e.g. days after a delivery was confirmed. It is business-initiated and
 * almost always lands OUTSIDE the 24-hour customer-service window, so it MUST
 * open with an approved template: free text here failed with Meta 131047
 * ("more than 24 hours have passed since the customer last replied"). It sends
 * the approved `hc_balance_reminder` template; {full_name} / {bank_block} /
 * {amount} fill its {{1}} {{2}} {{3}} IN ORDER, per company/contact — no account
 * number in source. The engine flattens every template param to one line (Meta
 * rejects a newline in a body parameter), so the multi-line {bank_block} arrives
 * as a single line.
 */

// Inbox / DEMO preview — what the thread shows. The real send uses the named
// Meta template; this mirrors its approved copy with named placeholders.
const BALANCE_REMINDER_MSG = `Hi {full_name}, our records show an outstanding balance payment for your order(s) with Houzs Century.

Kindly complete the payment so we can proceed with your delivery as planned.

{bank_block}

💵 Amount Due: RM {amount}

Please send the payment slip here once done — we'll verify and secure your delivery slot right away 🚚`;

export const balanceReminderFlow: SeedFlow = {
  key: "balance_reminder",
  name: "Balance Reminder",
  description:
    "Standalone outstanding-balance nudge via the hc_balance_reminder template: bank block + amount, tagged for collection.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "balance_due" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 120 },
      {
        id: "msg",
        type: "send_template",
        x: 240,
        y: 120,
        data: {
          templateName: "hc_balance_reminder",
          templateLang: "en",
          templateParams: ["{full_name}", "{bank_block}", "{amount}"],
          message: BALANCE_REMINDER_MSG,
        },
      },
      { id: "tag", type: "add_tag", x: 460, y: 120, data: { tag: "balance collection" } },
      { id: "done", type: "end", x: 680, y: 120, data: {} },
    ],
    edges: [
      { from: "trigger", to: "msg" },
      { from: "msg", to: "tag" },
      { from: "tag", to: "done" },
    ],
  }),
};

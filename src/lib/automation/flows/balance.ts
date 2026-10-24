import type { SeedFlow } from "./types";

/**
 * Balance Reminder — a standalone outstanding-balance nudge (decision B).
 *
 * The ERP fires this by name (trigger WEBHOOK) to chase an unpaid balance on its
 * own. It is business-initiated and almost always lands OUTSIDE the 24-hour
 * customer-service window, so it MUST open with an approved template: free text
 * here failed with Meta 131047 ("more than 24 hours have passed since the
 * customer last replied"). It sends the approved `hc_order_balance_collection`
 * UTILITY template (en). The bank details are fixed IN the template itself
 * (Houzs Century's account), so the only variables are {{1}} customer name and
 * {{2}} amount — filled by {full_name} / {amount} IN ORDER. No account number in
 * source: the preview below uses the ERP's {bank_block} variable for the inbox,
 * never a literal account.
 */

// Inbox / DEMO preview — what the thread shows. The real send uses the named
// Meta template (bank details static there); this mirrors its copy, with
// {bank_block} / {amount} filled from the contact so no account number lives here.
const BALANCE_REMINDER_MSG = `Hi {full_name} 📢 Payment Status Update:
A pending balance has been identified for your order with Houzs Century.

Transaction Details:
{bank_block}
💰 Amount: RM {amount}

Settling this balance keeps your current delivery schedule. Please upload the transaction record (receipt) to this chat for verification. 🧾`;

export const balanceReminderFlow: SeedFlow = {
  key: "balance_reminder",
  name: "Balance Reminder",
  description:
    "Standalone outstanding-balance nudge via the hc_order_balance_collection template: customer name + amount, tagged for collection.",
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
          templateName: "hc_order_balance_collection",
          templateLang: "en",
          templateParams: ["{full_name}", "{amount}"],
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

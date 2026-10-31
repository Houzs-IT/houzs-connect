import type { SeedFlow } from "./types";

/**
 * Balance Reminder — a standalone outstanding-balance nudge (decision B).
 *
 * The ERP fires this by name (trigger WEBHOOK) to chase an unpaid balance on its
 * own. It is business-initiated and almost always lands OUTSIDE the 24-hour
 * customer-service window, so it MUST open with an approved template: free text
 * here failed with Meta 131047 ("more than 24 hours have passed since the
 * customer last replied").
 *
 * PER-COMPANY BANK. The bank account is fixed text IN the Meta template, not a
 * variable (a template body can only carry single-value {{n}} slots, and the
 * bank block is multi-line) — so `hc_order_balance_collection` bakes HOUZS
 * CENTURY's account. A non-Houzs order (2990, which shares Houzs's WhatsApp
 * number) sent through it would tell the customer to pay Houzs's account — the
 * wrong company. So the flow routes on the order's company:
 *   • Houzs            -> hc_order_balance_collection (its baked bank is correct)
 *   • anything else    -> NO auto-send; tag for the team to collect by hand.
 * When 2990 gets its own approved template (hc_order_balance_collection_2990,
 * its bank baked), add a branch that sends it; until then the fallback keeps a
 * 2990 customer from ever being shown Houzs's account.
 *
 * The company signal: the ERP's `company_code` ("HOUZS" / "2990") once it sends
 * it; `ref_1`'s doc_no prefix ("2990-SO…" vs "HC…") is the interim fallback so
 * the guard works before that ERP change ships. company_code absent AND an HC
 * ref → the default (Houzs) branch, i.e. today's behaviour unchanged.
 *
 * The {{1}}/{{2}} slots are {full_name} / {amount} IN ORDER. No account number
 * in source: the inbox preview uses the ERP's {bank_block} variable, never a
 * literal account.
 */

// Inbox / DEMO preview — what the thread shows when Connect cannot fetch the
// approved template body. Mirrors the sent copy; {company_signature} / {bank_block}
// / {amount} are filled from the contact, so the preview names the right company
// and no account number lives here.
const BALANCE_REMINDER_MSG = `Hi {full_name} 📢 Payment Status Update:
A pending balance has been identified for your order with {company_signature}.

Transaction Details:
{bank_block}
💰 Amount: RM {amount}

Settling this balance keeps your current delivery schedule. Please upload the transaction record (receipt) to this chat for verification. 🧾`;

export const balanceReminderFlow: SeedFlow = {
  key: "balance_reminder",
  name: "Balance Reminder",
  description:
    "Standalone outstanding-balance nudge: routes by company so each sends its own bank. Houzs → hc_order_balance_collection; other companies (e.g. 2990) → manual collection until they have their own approved template. Tagged for collection.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "balance_due" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 160 },
      {
        id: "company_router",
        type: "criteria_router",
        x: 240,
        y: 160,
        data: {
          // A non-Houzs order must NOT auto-send the Houzs-bank template. Match
          // 2990 by the ERP's company_code when present, and by the SO doc_no
          // prefix as the interim fallback until the ERP sends company_code.
          rules: [
            { branch: "manual", field: "company_code", op: "eq", value: "2990" },
            { branch: "manual", field: "ref_1", op: "contains", value: "2990-SO" },
          ],
        },
      },
      // Houzs — the approved template carries Houzs Century's bank, so it is safe
      // to auto-send.
      {
        id: "msg_hc",
        type: "send_template",
        x: 480,
        y: 60,
        data: {
          templateName: "hc_order_balance_collection",
          templateLang: "en",
          templateParams: ["{full_name}", "{amount}"],
          message: BALANCE_REMINDER_MSG,
        },
      },
      { id: "tag_hc", type: "add_tag", x: 700, y: 60, data: { tag: "balance collection" } },
      // Non-Houzs — send nothing (no correct template yet, and free text is
      // refused outside the 24h window). Tag it so it still shows in the balance
      // worklist for the salesperson to collect by hand.
      { id: "tag_manual", type: "add_tag", x: 480, y: 260, data: { tag: "balance collection" } },
      { id: "done", type: "end", x: 920, y: 160, data: {} },
    ],
    edges: [
      { from: "trigger", to: "company_router" },
      { from: "company_router", to: "msg_hc", branch: "default" },
      { from: "company_router", to: "tag_manual", branch: "manual" },
      { from: "msg_hc", to: "tag_hc" },
      { from: "tag_hc", to: "done" },
      { from: "tag_manual", to: "done" },
    ],
  }),
};

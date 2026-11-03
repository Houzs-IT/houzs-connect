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
 * bank block is multi-line) — so each company has its own approved template with
 * its own account baked in, and the flow routes on the order's company:
 *   • Houzs  -> hc_order_balance_collection       (Houzs Century's bank)
 *   • 2990   -> hc_order_balance_collection_2990   (2990 Home's bank)
 * 2990's Home shares Houzs's WhatsApp number, so without this routing a 2990
 * order's reminder would send Houzs's account — the wrong company's bank.
 *
 * The company signal: the ERP's `company_code` ("HOUZS" / "2990") once it sends
 * it; `ref_1`'s doc_no prefix ("2990-SO…" vs "HC…") is the fallback that works
 * before that ERP change ships. company_code absent AND an HC ref → the default
 * (Houzs) branch.
 *
 * ADDING A COMPANY: approve its own `hc_order_balance_collection_<code>` on Meta
 * (its bank baked), then add a rule + send node here. Both templates' slots are
 * {{1}} {full_name} / {{2}} {amount} IN ORDER. No account number in source: the
 * inbox preview uses the ERP's {bank_block} variable, never a literal account.
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
    "Standalone outstanding-balance nudge: routes by company so each sends its own bank. Houzs → hc_order_balance_collection; 2990 → hc_order_balance_collection_2990. Tagged for collection.",
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
          // Route 2990 to its own template (its bank baked) — the Houzs template
          // would tell a 2990 customer to pay Houzs's account. Match on the ERP's
          // company_code when present, and on the SO doc_no prefix as the fallback
          // until the ERP sends it. Everything else → default (Houzs).
          rules: [
            { branch: "c2990", field: "company_code", op: "eq", value: "2990" },
            { branch: "c2990", field: "ref_1", op: "contains", value: "2990-SO" },
          ],
        },
      },
      // Houzs — its approved template carries Houzs Century's bank.
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
      // 2990 — its own approved template carries 2990 Home's bank.
      {
        id: "msg_2990",
        type: "send_template",
        x: 480,
        y: 260,
        data: {
          templateName: "hc_order_balance_collection_2990",
          templateLang: "en",
          templateParams: ["{full_name}", "{amount}"],
          message: BALANCE_REMINDER_MSG,
        },
      },
      { id: "tag_2990", type: "add_tag", x: 700, y: 260, data: { tag: "balance collection" } },
      { id: "done", type: "end", x: 920, y: 160, data: {} },
    ],
    edges: [
      { from: "trigger", to: "company_router" },
      { from: "company_router", to: "msg_hc", branch: "default" },
      { from: "company_router", to: "msg_2990", branch: "c2990" },
      { from: "msg_hc", to: "tag_hc" },
      { from: "tag_hc", to: "done" },
      { from: "msg_2990", to: "tag_2990" },
      { from: "tag_2990", to: "done" },
    ],
  }),
};

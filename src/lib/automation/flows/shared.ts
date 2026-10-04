import type { FlowGraph } from "../types";
import type { SeedForm } from "./types";

/**
 * Copy, forms and the graph shared by the delivery-date flows (New Delivery and
 * New Amend). The two are the same conversation — confirm or amend a date, then
 * balance / property / disposal — reached from a different entry context (a
 * fresh delivery vs an ERP-initiated reschedule), so they differ only in the
 * opening message. Keeping one graph builder here stops the customer copy and
 * the branch wiring from drifting between them.
 *
 * Message copy follows the owner-approved Seampify wording with the locked
 * rebuild changes (docs/connect-rebuild-spec.zh.md). Company-specific values are
 * variables the ERP fills per company/contact — {company_signature},
 * {bank_block}, {disposal_block} — never literals here; the bank block carries
 * an account number and this repo must not hold one.
 */

// Spec section 4, mandatory change 1 — "exactly one day before".
export const CONFIRM_THANKS = `Thank you for confirming! We will contact you again exactly *one* day before your delivery to confirm the driver information and expected arrival time.`;

export const BALANCE = `As an update, our system detected that there is a balance payment for your order(s).

Kindly complete the payment so we can proceed with your delivery as planned.

{bank_block}

💵 Amount Due: RM {balance_due}

Please send the payment slip here once done — we'll verify and secure your delivery slot right away 🚚`;

export const PROPERTY_INTRO = `To help smoothen your delivery process, we'll need to collect a few details ⬇️`;

export const GENERIC_ACK = `Thank you for letting us know. We'll take note of your situation and plan accordingly.`;

export const DISPOSAL_FEE = `Noted on your request. Please see our disposal fee details below:

{disposal_block}

✨ {company_signature} Special: Purchase 1 new bedframe set from us, and we will provide FREE disposal for your old bedframe set!

Note: Free disposal applies to bedframe sets only. Disposal charges still apply for sofas.

We'll take note of your request and arrange the schedule accordingly. Thank you!`;

// Spec section 7 — locked copy, verbatim.
export const LOCKED = `Your delivery date is already confirmed and locked in. 🔒

To make any changes, please reply here and our team will assist you — kindly note that a change within 3 days of the confirmed date may incur an RM150 late cancellation fee.

Thank you for your understanding!`;

// Storage fee (postpone > 30 days) AND the new Late Cancellation Fee (spec 7).
export const AMEND_START = `No problem! We can help you reschedule.

📌 _Note:_
_A storage fee of RM150 per month applies if delivery is postponed more than 30 days from the original scheduled date. Separately, once a delivery date is confirmed, a change made within 3 days of that date (reschedule or cancellation), or a cancellation due to non-payment, may incur an RM150 late cancellation fee._

To help us coordinate your new delivery slot, please let us know the reason for the change:`;

export const CHOOSE_DATE = `Please choose your desired delivery date.

_Once you submit your preferred date, our team will review and plan according to our current delivery schedule._

📌 _Important: once the final date is confirmed, it cannot be amended or cancelled. Please ensure the site is ready and someone is available to avoid additional charges (re-delivery or extra storage fees)._`;

export const CONFIRM_NEW_DATE = `*Delivery Confirmation*

For your order *{ref_1}*, is this the correct desired date?

📅 New Delivery Date: *{amended_delivery_date}*`;

export const AMEND_SUBMITTED = `Thank you for submitting your desired delivery date! Our system will now review your request and plan accordingly. Once our system has scheduled the trip, we will contact you again to officially confirm the final delivery date.`;

// Forms both flows send. `key` is the local handle the graph references; the
// seed resolves it to the published form row id. `select` options are not yet
// wired in the form model, so a published Flow renders these as text inputs for
// now (follow-up); the routers below tolerate that.
export const PROPERTY_FORM_KEY = "property_details";
export const DATE_FORM_KEY = "new_delivery_date";

export const SHARED_FORMS: SeedForm[] = [
  {
    key: PROPERTY_FORM_KEY,
    name: "Property Details",
    fields: [
      { key: "house_type", label: "Property type", type: "select" },
      { key: "delivery_purpose", label: "What is this delivery for?", type: "select" },
      { key: "need_disposal", label: "Dispose of old items?", type: "select" },
      { key: "disposal_item", label: "Items to dispose (if any)", type: "text" },
    ],
  },
  {
    key: DATE_FORM_KEY,
    name: "New Delivery Date",
    fields: [{ key: "amended_delivery_date", label: "Preferred delivery date", type: "date" }],
  },
];

/**
 * The shared delivery-date graph: a Confirm / Amend fork, the confirm tail
 * (thanks -> balance? -> Property Details form -> disposal fee / ack) and the
 * amend sub-flow (confirm-lock guard -> reason -> new-date form -> re-confirm ->
 * submit). `opening` is the one message that differs between the flows. The
 * Confirm / Amend decision is POSTed to the ERP via {callback_url} (injected on
 * the trigger payload) — no ERP host or key is written here.
 */
export function buildDeliveryGraph(opts: {
  opening: string;
  formIds: Record<string, string>;
}): FlowGraph {
  const { opening, formIds } = opts;
  return {
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 320 },
      {
        id: "ask_date",
        type: "ask_buttons",
        x: 240,
        y: 320,
        data: {
          message: opening,
          buttons: [
            { id: "confirm", label: "Confirm Date" },
            { id: "amend", label: "Amend Date" },
          ],
        },
      },

      // ── Confirm branch ──
      { id: "set_confirm", type: "set_attribute", x: 480, y: 120, data: { key: "button_status", value: "Confirm" } },
      { id: "set_done", type: "set_attribute", x: 700, y: 120, data: { key: "delivery_message_status_1", value: "Done Scheduling" } },
      { id: "tag_sched", type: "add_tag", x: 920, y: 120, data: { tag: "scheduling" } },
      {
        id: "cb_confirm",
        type: "call_rest_api",
        x: 1140,
        y: 120,
        data: { method: "POST", url: "{callback_url}", body: `{"ref":"{ref_1}","decision":"confirm","source":"connect"}` },
      },
      { id: "thanks_confirm", type: "send_text", x: 1360, y: 120, data: { message: CONFIRM_THANKS } },
      {
        id: "bal_router",
        type: "criteria_router",
        x: 1580,
        y: 120,
        data: { rules: [{ branch: "has_balance", field: "balance_due", op: "set" }] },
      },
      { id: "bal_msg", type: "send_text", x: 1800, y: 40, data: { message: BALANCE } },
      { id: "tag_balance", type: "add_tag", x: 2020, y: 40, data: { tag: "balance collection" } },
      {
        id: "send_property",
        type: "send_form",
        x: 2240,
        y: 120,
        data: { formId: formIds[PROPERTY_FORM_KEY], flowCta: "Share details", message: PROPERTY_INTRO },
      },
      {
        id: "prop_router",
        type: "criteria_router",
        x: 2460,
        y: 120,
        data: {
          rules: [
            { branch: "newhouse", field: "delivery_purpose", op: "eq", value: "Move-in New House" },
            { branch: "disposal", field: "need_disposal", op: "eq", value: "Yes" },
          ],
        },
      },
      { id: "disposal_fee", type: "send_text", x: 2680, y: 40, data: { message: DISPOSAL_FEE } },
      { id: "generic_ack", type: "send_text", x: 2680, y: 200, data: { message: GENERIC_ACK } },
      { id: "confirm_end", type: "end", x: 2900, y: 120, data: {} },

      // ── Amend branch ──
      {
        id: "amend_guard",
        type: "criteria_router",
        x: 480,
        y: 520,
        data: { rules: [{ branch: "locked", field: "button_status", op: "eq", value: "Confirm" }] },
      },
      { id: "locked_msg", type: "send_text", x: 700, y: 420, data: { message: LOCKED } },
      { id: "locked_end", type: "end", x: 920, y: 420, data: {} },
      { id: "set_amend", type: "set_attribute", x: 700, y: 620, data: { key: "button_status", value: "Amend" } },
      { id: "set_amend_flag", type: "set_attribute", x: 920, y: 620, data: { key: "date_amended", value: "true" } },
      {
        id: "ask_reason",
        type: "ask_buttons",
        x: 1140,
        y: 620,
        data: {
          message: AMEND_START,
          buttons: [
            { id: "renovation", label: "Renovation Delay" },
            { id: "date_unavail", label: "Date Unavailable" },
          ],
        },
      },
      { id: "reason_reno", type: "set_attribute", x: 1360, y: 540, data: { key: "amend_date_reason", value: "Renovation Delay" } },
      { id: "reason_unavail", type: "set_attribute", x: 1360, y: 700, data: { key: "amend_date_reason", value: "Date Unavailable" } },
      {
        id: "ask_new_date",
        type: "send_form",
        x: 1580,
        y: 620,
        data: { formId: formIds[DATE_FORM_KEY], flowCta: "Choose date", message: CHOOSE_DATE },
      },
      {
        id: "confirm_new_date",
        type: "ask_buttons",
        x: 1800,
        y: 620,
        data: {
          message: CONFIRM_NEW_DATE,
          buttons: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      },
      { id: "set_pending", type: "set_attribute", x: 2020, y: 620, data: { key: "delivery_message_status_1", value: "Pending Reschedule" } },
      { id: "tag_resched", type: "add_tag", x: 2240, y: 620, data: { tag: "pending reschedule" } },
      {
        id: "cb_amend",
        type: "call_rest_api",
        x: 2460,
        y: 620,
        data: {
          method: "POST",
          url: "{callback_url}",
          body: `{"ref":"{ref_1}","decision":"amend","reason":"{amend_date_reason}","new_date":"{amended_delivery_date}","source":"connect"}`,
        },
      },
      { id: "amend_submitted", type: "send_text", x: 2680, y: 620, data: { message: AMEND_SUBMITTED } },
      { id: "amend_end", type: "end", x: 2900, y: 620, data: {} },
    ],
    edges: [
      { from: "trigger", to: "ask_date" },

      // Confirm
      { from: "ask_date", to: "set_confirm", branch: "confirm" },
      { from: "set_confirm", to: "set_done" },
      { from: "set_done", to: "tag_sched" },
      { from: "tag_sched", to: "cb_confirm" },
      { from: "cb_confirm", to: "thanks_confirm" },
      { from: "thanks_confirm", to: "bal_router" },
      { from: "bal_router", to: "bal_msg", branch: "has_balance" },
      { from: "bal_router", to: "send_property", branch: "default" },
      { from: "bal_msg", to: "tag_balance" },
      { from: "tag_balance", to: "send_property" },
      { from: "send_property", to: "prop_router" },
      { from: "prop_router", to: "generic_ack", branch: "newhouse" },
      { from: "prop_router", to: "disposal_fee", branch: "disposal" },
      { from: "prop_router", to: "generic_ack", branch: "default" },
      { from: "disposal_fee", to: "confirm_end" },
      { from: "generic_ack", to: "confirm_end" },

      // Amend
      { from: "ask_date", to: "amend_guard", branch: "amend" },
      { from: "amend_guard", to: "locked_msg", branch: "locked" },
      { from: "amend_guard", to: "set_amend", branch: "default" },
      { from: "locked_msg", to: "locked_end" },
      { from: "set_amend", to: "set_amend_flag" },
      { from: "set_amend_flag", to: "ask_reason" },
      { from: "ask_reason", to: "reason_reno", branch: "renovation" },
      { from: "ask_reason", to: "reason_unavail", branch: "date_unavail" },
      { from: "reason_reno", to: "ask_new_date" },
      { from: "reason_unavail", to: "ask_new_date" },
      { from: "ask_new_date", to: "confirm_new_date" },
      { from: "confirm_new_date", to: "set_pending", branch: "yes" },
      { from: "confirm_new_date", to: "ask_new_date", branch: "no" },
      { from: "set_pending", to: "tag_resched" },
      { from: "tag_resched", to: "cb_amend" },
      { from: "cb_amend", to: "amend_submitted" },
      { from: "amend_submitted", to: "amend_end" },
    ],
  };
}

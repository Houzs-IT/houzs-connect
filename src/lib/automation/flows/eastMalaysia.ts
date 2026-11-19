import type { SeedFlow, SeedForm } from "./types";
import { buildTemplateSendGraph, ERP_CALLBACK_HEADERS } from "./shared";

/**
 * East Malaysia delivery — a three-touchpoint flow for Sabah / Sarawak / Labuan
 * orders, which ship by sea freight via a transporter instead of the Peninsular
 * own-truck, fixed-delivery-date model. The existing Local delivery flows
 * (newDelivery / postage / driverInfo) do NOT fit here, so this is its own set.
 * Owner-approved design: docs/eastmy-delivery-flow (PDF, 2026-11-19).
 *
 * The three ERP-fired touchpoints:
 *   1. Prep Notice   (event eastmy_prep)    — timeline heads-up + collect the
 *      transporter's delivery details + (in-window) request the balance.
 *   2. Shipped       (event eastmy_shipped) — one-shot "on its way" notice with
 *      tracking no. + ETA.
 *   3. Arrived       (event eastmy_arrived) — one-shot "arrived at port" notice;
 *      the transporter then contacts the customer for home delivery.
 *
 * Balance is REUSED, not rebuilt: touchpoint 1 sends the in-chat balance text
 * (same {bank_block} pattern as the Local delivery graph) while the window is
 * open; any later chase (at arrival, outside the window) is the existing
 * standalone Balance Reminder (balance.ts, event balance_due →
 * hc_order_balance_collection), which the ERP fires on its own — no new work.
 *
 * ERP must inject on the prep trigger: full_name, ref_1, refs_all, phone,
 * callback_url, and amount when a balance is outstanding. Shipped adds
 * tracking_no, eta. The destination shown to customers is a FIXED
 * literal "EM" baked into each template send (owner, 2026-11-19) — not injected.
 * All three seed DRAFT/disabled; enable them once the templates are approved on
 * Meta.
 */

// ── Touchpoint 1 copy ──────────────────────────────────────────────────────

// Opener (DEMO/inbox preview; the real send uses hc_eastmy_prep_notice). The
// 2–3 week window and "collect balance after arrival" wording is the approved
// customer narrative; {company_signature} resolves per contact, "EM" is fixed.
const PREP_OPENING = `Hi {full_name} 👋

Good news! We'll start preparing your {company_signature} order *{ref_1}* this week to next week. After that, our transporter will arrange sea freight to East Malaysia 🚢

🕒 Estimated arrival at EM port: around *2–3 weeks* after dispatch.

Once it arrives and is unloaded at the port, we'll collect the balance payment — then our transporter will contact you to arrange delivery to your door 🚚

If everything's clear, tap *"Noted"*. If you have any questions, tap *"I have a question"* 👇`;

const NOTED_BTN = "Noted";
const QUESTION_BTN = "I have a question";

// In-window balance request — the East-MY wording of the Local delivery graph's
// BALANCE text (shared.ts). {bank_block} / {amount} are injected per company;
// no account number lives in source.
const EASTMY_BALANCE = `As an update, there is a balance payment on your order(s).

Kindly complete the payment so we can proceed with shipping and delivery as planned.

{bank_block}

💵 Amount Due: RM {amount}

Please send the payment slip here once done — we'll verify and keep your order moving 🚢`;

const DETAILS_INTRO = `To arrange your delivery, we'll need a few details ⬇️`;

const ACK_NOTED = `Thank you! We've noted your details and will keep you updated at every step — shipping, arrival, and delivery. 🚚`;

const HANDOFF = `No problem — our team will get back to you shortly to help with your question. 🙌`;

// Fallback questions used only when the "East Malaysia Delivery Details" Flow
// form is not published on Meta (the send_form node then skips and
// delivery_address stays empty). Each answer lands on the SAME contact field the
// form writes, so the ERP callback reads one shape whichever path ran.
const ASK_NAME = `To arrange delivery, may I have the *recipient's full name*? Please reply in a single message.`;
const ASK_PHONE = `Thank you! And a *local contact number* in East Malaysia for the delivery?`;
const ASK_ADDRESS = `Lastly, please reply with the *full delivery address* (including postcode) in a single message.`;

// ── Touchpoint 2 & 3 copy (one-shot template sends) ─────────────────────────

const SHIPPED_MSG = `Hi {full_name} 👋 Your order *{ref_1}* is now on its way to East Malaysia by sea freight 🚢

Consignment / Tracking No.: *{tracking_no}*
Estimated arrival at EM port: *{eta}*

We'll notify you again once it arrives and is ready for the next step. Thank you for your patience! ✨`;

const ARRIVED_MSG = `Hi {full_name} 👋 Great news — your order *{ref_1}* has arrived at EM port and is being unloaded 📦

Our transporter will contact you shortly to arrange delivery to your door 🚚

Thank you for your patience! ✨`;

// ── Forms ───────────────────────────────────────────────────────────────────

const DETAILS_FORM_KEY = "eastmy_delivery_details";

const EASTMY_FORMS: SeedForm[] = [
  {
    key: DETAILS_FORM_KEY,
    name: "East Malaysia Delivery Details",
    fields: [
      { key: "recipient_name", label: "Recipient name", type: "text", required: true },
      { key: "recipient_phone", label: "Contact number", type: "phone", required: true },
      { key: "delivery_address", label: "Full delivery address (with postcode)", type: "text", required: true },
      { key: "remark", label: "Remarks (optional)", type: "text" },
    ],
  },
];

// ── Touchpoint 1 · Prep Notice ──────────────────────────────────────────────

export const eastMyPrepFlow: SeedFlow = {
  key: "eastmy_prep",
  name: "East Malaysia Prep Notice",
  description:
    "East-MY touchpoint 1: prep/sea-freight timeline + Noted/Question fork, collect delivery details (name/phone/address), in-window balance request, ERP callback.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "eastmy_prep" },
  forms: EASTMY_FORMS,
  build: (formIds) => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 260 },
      {
        id: "ask",
        type: "send_template",
        x: 240,
        y: 260,
        data: {
          templateName: "hc_eastmy_prep_notice",
          templateLang: "en",
          templateParams: ["{full_name}", "{ref_1}", "EM"],
          message: PREP_OPENING,
          buttons: [
            { id: NOTED_BTN, label: NOTED_BTN },
            { id: QUESTION_BTN, label: QUESTION_BTN },
          ],
        },
      },

      // ── Noted branch ──
      { id: "set_ack", type: "set_attribute", x: 460, y: 160, data: { key: "eastmy_status", value: "Acknowledged" } },
      { id: "tag_eastmy", type: "add_tag", x: 680, y: 160, data: { tag: "east malaysia" } },
      {
        id: "send_details",
        type: "send_form",
        x: 900,
        y: 160,
        data: { formId: formIds[DETAILS_FORM_KEY], flowCta: "Share details", message: DETAILS_INTRO },
      },
      // Form published + submitted → delivery_address is set; otherwise collect
      // the three fields by text (the form was skipped).
      {
        id: "have_router",
        type: "criteria_router",
        x: 1120,
        y: 160,
        data: { rules: [{ branch: "have", field: "delivery_address", op: "set" }] },
      },
      { id: "ask_name", type: "collect_input", x: 1120, y: 320, data: { message: ASK_NAME, saveTo: "recipient_name" } },
      { id: "ask_phone", type: "collect_input", x: 1340, y: 320, data: { message: ASK_PHONE, saveTo: "recipient_phone" } },
      { id: "ask_addr", type: "collect_input", x: 1560, y: 320, data: { message: ASK_ADDRESS, saveTo: "delivery_address" } },

      // Balance — only when the ERP injected an amount. Same in-window text as the
      // Local delivery graph.
      {
        id: "bal_router",
        type: "criteria_router",
        x: 1340,
        y: 160,
        data: { rules: [{ branch: "has_balance", field: "amount", op: "set" }] },
      },
      { id: "bal_msg", type: "send_text", x: 1560, y: 80, data: { message: EASTMY_BALANCE } },
      { id: "tag_balance", type: "add_tag", x: 1780, y: 80, data: { tag: "balance collection" } },

      // Report the collected details back to the ERP. A field the customer did
      // not give interpolates to its literal "{key}" — the ERP treats that as
      // blank (same convention as the Local property callback).
      {
        id: "cb_ack",
        type: "call_rest_api",
        x: 2000,
        y: 160,
        data: {
          method: "POST",
          url: "{callback_url}",
          headers: ERP_CALLBACK_HEADERS,
          body: `{"callback_id":"{run_id}-eastmy_ack","event":"eastmy_ack","ref":"{ref_1}","refs":"{refs_all}","phone":"{phone}","recipient_name":"{recipient_name}","recipient_phone":"{recipient_phone}","delivery_address":"{delivery_address}","remark":"{remark}","note":"source=connect"}`,
        },
      },
      { id: "ack", type: "send_text", x: 2220, y: 160, data: { message: ACK_NOTED } },
      { id: "done", type: "end", x: 2440, y: 160, data: {} },

      // ── Question branch ──
      { id: "tag_agent", type: "add_tag", x: 460, y: 420, data: { tag: "needs agent" } },
      { id: "handoff", type: "send_text", x: 680, y: 420, data: { message: HANDOFF } },
      { id: "q_end", type: "end", x: 900, y: 420, data: {} },
    ],
    edges: [
      { from: "trigger", to: "ask" },
      { from: "ask", to: "set_ack", branch: NOTED_BTN },
      { from: "ask", to: "tag_agent", branch: QUESTION_BTN },

      // Noted → details → balance? → callback → ack
      { from: "set_ack", to: "tag_eastmy" },
      { from: "tag_eastmy", to: "send_details" },
      { from: "send_details", to: "have_router" },
      { from: "have_router", to: "bal_router", branch: "have" },
      { from: "have_router", to: "ask_name", branch: "default" },
      { from: "ask_name", to: "ask_phone" },
      { from: "ask_phone", to: "ask_addr" },
      { from: "ask_addr", to: "bal_router" },
      { from: "bal_router", to: "bal_msg", branch: "has_balance" },
      { from: "bal_router", to: "cb_ack", branch: "default" },
      { from: "bal_msg", to: "tag_balance" },
      { from: "tag_balance", to: "cb_ack" },
      { from: "cb_ack", to: "ack" },
      { from: "ack", to: "done" },

      // Question
      { from: "tag_agent", to: "handoff" },
      { from: "handoff", to: "q_end" },
    ],
  }),
};

// ── Touchpoint 2 · Shipped (one-shot) ───────────────────────────────────────

export const eastMyShippedFlow: SeedFlow = {
  key: "eastmy_shipped",
  name: "East Malaysia Shipped",
  description:
    "East-MY touchpoint 2: one-shot 'on its way' notice (hc_eastmy_shipped) — tracking no. + ETA. No buttons.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "eastmy_shipped" },
  forms: [],
  build: () =>
    buildTemplateSendGraph({
      templateName: "hc_eastmy_shipped",
      params: ["{full_name}", "{ref_1}", "{tracking_no}", "EM", "{eta}"],
      message: SHIPPED_MSG,
      tag: "east malaysia",
    }),
};

// ── Touchpoint 3 · Arrived (one-shot) ───────────────────────────────────────

export const eastMyArrivedFlow: SeedFlow = {
  key: "eastmy_arrived",
  name: "East Malaysia Arrived",
  description:
    "East-MY touchpoint 3: one-shot 'arrived at port' notice (hc_eastmy_arrived); the transporter then contacts the customer for home delivery. Chase any unpaid balance via the standalone Balance Reminder.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "eastmy_arrived" },
  forms: [],
  build: () =>
    buildTemplateSendGraph({
      templateName: "hc_eastmy_arrived",
      params: ["{full_name}", "{ref_1}", "EM"],
      message: ARRIVED_MSG,
      tag: "east malaysia",
    }),
};

/** The East Malaysia set, in customer-journey order. Added to Houzs Century's
 *  REBUILD_FLOWS (flows/index.ts). 2990 can adopt it later with its own
 *  `_2990` templates if it ships to East Malaysia too. */
export const EASTMY_FLOWS: SeedFlow[] = [eastMyPrepFlow, eastMyShippedFlow, eastMyArrivedFlow];

import type { SeedFlow } from "./types";
import { ERP_CALLBACK_HEADERS } from "./shared";

/**
 * Postage Confirm — confirm the delivery address before scheduling (decision B).
 *
 * ERP-initiated (trigger WEBHOOK): the opener is the approved template
 * hc_order_postage_confirm (3 vars + Confirmed/Amend quick replies). Confirmed →
 * record + report; Amend → collect the corrected address (saved to
 * delivery_address) + report. The customer's tap routes via the template-button
 * parsing in the webhook; the two branch labels are the template's button text.
 *
 * ERP must inject full_name, customer_phone and delivery_address on the trigger
 * (go-live checklist) — the base delivery bundle does not carry phone/address yet.
 */

const CONFIRM_BTN = "Confirmed postage details";
const AMEND_BTN = "Amend postage details";

const OPENING = `Hi 👋 Before we arrange delivery for your {company_signature} order, please confirm your postage details:

👤 Name: *{full_name}*
📞 Phone: *{customer_phone}*
📍 Address: *{delivery_address}*

If everything's correct, tap *"Confirmed postage details"*. If anything needs updating, tap *"Amend postage details"* and our team will help 👇`;

const ACK_CONFIRMED = `Thank you! Your postage details are confirmed. We'll arrange your delivery accordingly. 🚚`;

const ASK_ADDRESS = `No problem — please reply with your correct delivery address in a single message, and our team will update it for you.`;

const ACK_AMEND = `Got it, thank you! We've noted your updated address and our team will confirm your delivery shortly.`;

export const postageFlow: SeedFlow = {
  key: "postage_confirm",
  name: "Postage Confirm",
  description:
    "Confirm the delivery address before scheduling (hc_order_postage_confirm): Confirmed records it, Amend collects the corrected address; both report to the ERP.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "postage" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 220 },
      {
        id: "ask",
        type: "send_template",
        x: 240,
        y: 220,
        data: {
          templateName: "hc_order_postage_confirm",
          templateLang: "en",
          templateParams: ["{full_name}", "{customer_phone}", "{delivery_address}"],
          message: OPENING,
          buttons: [
            { id: CONFIRM_BTN, label: CONFIRM_BTN },
            { id: AMEND_BTN, label: AMEND_BTN },
          ],
        },
      },
      { id: "set_confirmed", type: "set_attribute", x: 460, y: 120, data: { key: "postage_status", value: "Confirmed" } },
      { id: "tag_confirmed", type: "add_tag", x: 680, y: 120, data: { tag: "postage confirmed" } },
      {
        id: "cb_confirmed",
        type: "call_rest_api",
        x: 900,
        y: 120,
        // The ERP's /api/chat-callback contract (see shared.ts): X-Chat-Key from
        // the Worker secret, event + ref + the bundle, callback_id per run.
        data: {
          method: "POST",
          url: "{callback_url}",
          headers: ERP_CALLBACK_HEADERS,
          body: `{"callback_id":"{run_id}-postage_confirm","event":"postage_confirm","ref":"{ref_1}","refs":"{refs_all}","phone":"{phone}","note":"source=connect"}`,
        },
      },
      { id: "ack_confirmed", type: "send_text", x: 1120, y: 120, data: { message: ACK_CONFIRMED } },
      { id: "ask_addr", type: "collect_input", x: 460, y: 320, data: { message: ASK_ADDRESS, saveTo: "delivery_address" } },
      { id: "set_amended", type: "set_attribute", x: 680, y: 320, data: { key: "postage_status", value: "Amended" } },
      {
        id: "cb_amend",
        type: "call_rest_api",
        x: 900,
        y: 320,
        data: {
          method: "POST",
          url: "{callback_url}",
          headers: ERP_CALLBACK_HEADERS,
          body: `{"callback_id":"{run_id}-postage_amend","event":"postage_amend","ref":"{ref_1}","refs":"{refs_all}","phone":"{phone}","address":"{delivery_address}","note":"source=connect"}`,
        },
      },
      { id: "ack_amend", type: "send_text", x: 1120, y: 320, data: { message: ACK_AMEND } },
      { id: "done", type: "end", x: 1340, y: 220, data: {} },
    ],
    edges: [
      { from: "trigger", to: "ask" },
      { from: "ask", to: "set_confirmed", branch: CONFIRM_BTN },
      { from: "set_confirmed", to: "tag_confirmed" },
      { from: "tag_confirmed", to: "cb_confirmed" },
      { from: "cb_confirmed", to: "ack_confirmed" },
      { from: "ack_confirmed", to: "done" },
      { from: "ask", to: "ask_addr", branch: AMEND_BTN },
      { from: "ask_addr", to: "set_amended" },
      { from: "set_amended", to: "cb_amend" },
      { from: "cb_amend", to: "ack_amend" },
      { from: "ack_amend", to: "done" },
    ],
  }),
};

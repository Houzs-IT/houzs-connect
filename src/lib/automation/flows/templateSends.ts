import type { SeedFlow } from "./types";
import { buildTemplateSendGraph } from "./shared";

/**
 * The "send one approved template" WS-A flows (decision B): reminders, driver
 * info, delivery-completed, service-case-received, overdue-order. Each fires by
 * name (trigger WEBHOOK) and sends a single button-less template via the
 * send_template node, then ends.
 *
 * Bodies below mirror the APPROVED templates on the Connect Templates page
 * (chat.houzscentury.com/templates) and are the DEMO/inbox preview; the real
 * send uses the named Meta template. `params` are the contact-field placeholders
 * filling {{1}}, {{2}}, … in order — they must match the attribute keys the ERP
 * injects on the trigger (go-live wiring). Reminders are MANUAL-triggered first
 * (spec section 10). Templates with Confirm/Amend buttons (postpone, postage)
 * are NOT here — they need the delivery graph + the button-id mapping.
 */

function templateFlow(opts: {
  key: string;
  name: string;
  description: string;
  event: string;
  templateName: string;
  params: string[];
  message: string;
  /** Optional contact tag applied after the send (add_tag node). */
  tag?: string;
}): SeedFlow {
  return {
    key: opts.key,
    name: opts.name,
    description: opts.description,
    triggerType: "WEBHOOK",
    triggerConfig: { source: "erp", event: opts.event },
    forms: [],
    build: () =>
      buildTemplateSendGraph({
        templateName: opts.templateName,
        params: opts.params,
        message: opts.message,
        tag: opts.tag,
      }),
  };
}

export const reminder1Flow = templateFlow({
  key: "reminder_1",
  name: "Reminder 1",
  description: "First delivery-scheduling reminder (manual): hc_order_reminder_1, full_name + order ref.",
  event: "reminder_1",
  templateName: "hc_order_reminder_1",
  params: ["{full_name}", "{ref_1}"],
  message: `Hi {full_name} 👋 Just a friendly reminder from {company_signature} about your order *{ref_1}* — your delivery details are ready, and we'd love to share them with you. Whenever you have a moment, simply reply to this message and we'll send your delivery date and driver information right away. Thank you!`,
});

export const reminder2Flow = templateFlow({
  key: "reminder_2",
  name: "Reminder 2",
  description: "Second delivery-scheduling reminder (manual): hc_order_reminder_2, full_name + order ref.",
  event: "reminder_2",
  templateName: "hc_order_reminder_2",
  params: ["{full_name}", "{ref_1}"],
  message: `Hi {full_name} 👋 A gentle follow-up from {company_signature} about your order *{ref_1}* — we're still holding your delivery details and would love to help get it scheduled. Whenever you have a moment, simply reply to this message and we'll share your delivery date and keep you updated right here on WhatsApp. Thank you!`,
});

export const reminder3Flow = templateFlow({
  key: "reminder_3",
  name: "Reminder 3",
  description: "Final delivery-scheduling reminder (manual): hc_order_reminder_3, full_name + order ref.",
  event: "reminder_3",
  templateName: "hc_order_reminder_3",
  params: ["{full_name}", "{ref_1}"],
  message: `Hi {full_name} 👋 One last friendly reminder from {company_signature} about your order *{ref_1}*. We've been trying to reach you to arrange delivery. So we can keep your preferred slot, please reply to this message with a quick confirmation. If we don't hear back, we may need to release the slot and reschedule — but just message us anytime and we'll sort it out together. Thank you!`,
});

export const driverInfoFlow = templateFlow({
  key: "driver_info",
  name: "Driver Info",
  description:
    "Driver + delivery details the day before (hc_order_driver_info): date, time, driver name/contact/IC, lorry plate.",
  event: "driver_info",
  templateName: "hc_order_driver_info",
  params: [
    "{full_name}",
    "{client_delivery_date}",
    "{delivery_time}",
    "{drivers_name}",
    "{drivers_contact}",
    "{drivers_ic}",
    "{car_plate}",
  ],
  message: `Hi {full_name} 👋 This is a friendly reminder from {company_signature}. Below is your delivery and driver information:
🗓 Delivery Date: *{client_delivery_date}*
Time: *{delivery_time}*
🚛 Driver: *{drivers_name}*
Contact: *{drivers_contact}*
🪪 Driver IC: *{drivers_ic}*
Lorry Plate: *{car_plate}*
📍 Reminders:
1. Please ensure someone is available to receive the delivery during the time slot.
2. Prepare access in advance if needed (guardhouse pass / building entry).
3. If your residence requires a visitor QR code, please generate it and send it to our driver.
Thank you!`,
});

export const deliveryCompletedFlow = templateFlow({
  key: "delivery_completed",
  name: "Delivery Completed",
  description: "Delivered-confirmation thank-you (delivery_completed_thanks): full_name + order ref.",
  event: "delivery_completed",
  templateName: "delivery_completed_thanks",
  params: ["{full_name}", "{ref_1}"],
  message: `Hi {full_name}, This is a confirmation that your order {ref_1} was successfully delivered today. Thank you for your understanding and for purchasing our products. We sincerely appreciate your support.`,
});

// Overdue Order — a one-way heads-up when a Sales Order's delivery will run LATE
// because of a production delay. The operator sends it by name from the Delivery
// Planning board's Send Message menu; it apologises and gives a reason. No
// buttons — distinct from Postpone, which commits a proposed date and opens a
// Confirm / Amend conversation.
//
// Template `overdue_order_status_update` has FOUR positional params:
//   {{1}} full_name, {{2}} order ref, {{3}} amend reason — the ERP injects
//   `amend_date_reason` (the DP "amend reason" column) on the trigger — and {{4}} a
//   FIXED timeframe string. The template keeps the {{4}} slot, so the send must
//   still supply it; it is a literal here ("in next 2 weeks"), not a token. If
//   the amend reason is not injected, {{3}} sends the literal "{amend_date_reason}".
export const overdueOrderFlow = templateFlow({
  key: "overdue_order",
  name: "Overdue Order",
  description:
    "Production-delay heads-up for a late order (one-way): overdue_order_status_update, full_name + order ref + amend reason; {{4}} fixed 'in next 2 weeks'. No buttons.",
  event: "overdue_order",
  templateName: "overdue_order_status_update",
  params: ["{full_name}", "{ref_1}", "{amend_date_reason}", "in next 2 weeks"],
  message: `Hi {full_name}, this is the Customer Service Team from Houzs Century.

We sincerely apologize for the delay with your order *{ref_1}*.
Due to *{amend_date_reason}*, your order requires additional time to ensure everything meets our standards. Our team is actively working on your items, and we expect to deliver your order within the next delivery timeframe *in next 2 weeks*. Our logistics team will contact you shortly to confirm the exact date and time. Thank you for your patience and for giving us the opportunity to make this right.

Thank you for your patience and understanding! 🙏`,
});

// After-sales (ASSR) acknowledgement — the FIRST message a customer gets when a
// Service Case is created in the ERP, before any date is arranged (that later
// confirm/amend conversation is the separate Service Arrangement flow). The ERP
// fires this by name on create and injects full_name, ref_1 (the SO/order ref)
// and assr_no (the ASSR case number).
//
// Template `hc_service_case_received` has THREE positional params:
//   {{1}} full_name, {{2}} ref_1 (order ref), {{3}} assr_no (ASSR case number).
// All three MUST be sent — with only two, {{3}} went out as the literal "{{3}}"
// and Meta rejected the whole send (seen live 2026-11-03, ASSR/2611-008).
// Button-less, one-shot: reassure, then wait for a human — no callback. Tags the
// contact "service" on send so the inbox can filter service-case customers.
export const serviceCaseReceivedFlow = templateFlow({
  key: "service_case_received",
  name: "Service Case Received",
  description:
    "After-sales acknowledgement sent when an ASSR (service case) is created: hc_service_case_received, full_name + order ref + ASSR case no. Tags the contact service.",
  event: "service_case_received",
  templateName: "hc_service_case_received",
  params: ["{full_name}", "{ref_1}", "{assr_no}"],
  tag: "service",
  message: `Hi {full_name} 👋 This is Houzs Century.

We have received your service request for order *{ref_1}*.
Your service case number is *{assr_no}* — please keep this for any follow-up.

Our after-sales team is now arranging it and will contact you with the next update.

Thank you for your patience. 🙏`,
});

import type { SeedFlow } from "./types";
import { buildTemplateSendGraph } from "./shared";

/**
 * The "send one approved template" WS-A flows (decision B): reminders, driver
 * info, delivery-completed. Each fires by name (trigger WEBHOOK) and sends a
 * single button-less template via the send_template node, then ends.
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
}): SeedFlow {
  return {
    key: opts.key,
    name: opts.name,
    description: opts.description,
    triggerType: "WEBHOOK",
    triggerConfig: { source: "erp", event: opts.event },
    forms: [],
    build: () =>
      buildTemplateSendGraph({ templateName: opts.templateName, params: opts.params, message: opts.message }),
  };
}

export const reminder1Flow = templateFlow({
  key: "reminder_1",
  name: "Reminder 1",
  description: "First delivery-scheduling reminder (manual): hc_order_reminder_1, full_name + order ref.",
  event: "reminder_1",
  templateName: "hc_order_reminder_1",
  params: ["{full_name}", "{reference_no}"],
  message: `Hi {full_name} 👋 Just a friendly reminder from Houzs Century about your order *{reference_no}* — your delivery details are ready, and we'd love to share them with you. Whenever you have a moment, simply reply to this message and we'll send your delivery date and driver information right away. Thank you!`,
});

export const reminder2Flow = templateFlow({
  key: "reminder_2",
  name: "Reminder 2",
  description: "Second delivery-scheduling reminder (manual): hc_order_reminder_2, full_name + order ref.",
  event: "reminder_2",
  templateName: "hc_order_reminder_2",
  params: ["{full_name}", "{reference_no}"],
  message: `Hi {full_name} 👋 A gentle follow-up from Houzs Century about your order *{reference_no}* — we're still holding your delivery details and would love to help get it scheduled. Whenever you have a moment, simply reply to this message and we'll share your delivery date and keep you updated right here on WhatsApp. Thank you!`,
});

export const reminder3Flow = templateFlow({
  key: "reminder_3",
  name: "Reminder 3",
  description: "Final delivery-scheduling reminder (manual): hc_order_reminder_3, full_name + order ref.",
  event: "reminder_3",
  templateName: "hc_order_reminder_3",
  params: ["{full_name}", "{reference_no}"],
  message: `Hi {full_name} 👋 One last friendly reminder from Houzs Century about your order *{reference_no}*. We've been trying to reach you to arrange delivery. So we can keep your preferred slot, please reply to this message with a quick confirmation. If we don't hear back, we may need to release the slot and reschedule — but just message us anytime and we'll sort it out together. Thank you!`,
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
  message: `Hi {full_name} 👋 This is a friendly reminder from Houzs. Below is your delivery and driver information:
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
  params: ["{full_name}", "{reference_no}"],
  message: `Hi {full_name}, This is a confirmation that your order {reference_no} was successfully delivered today. Thank you for your understanding and for purchasing our products. We sincerely appreciate your support.`,
});

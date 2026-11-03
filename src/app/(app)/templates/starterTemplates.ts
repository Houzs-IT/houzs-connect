// The delivery follow-up copy Houzs actually runs on, ported from the templates
// already approved on the Seampify WABA so the wording customers know does not
// change. Copy is byte-identical to the originals, including the *bold* markers
// and emoji.
//
// Kept OUT of actions.ts because a "use server" module may only export async
// functions — exporting this array from there is a build error.
//
// DELIBERATELY NOT INCLUDED: the two balance-collection templates carry live
// bank account numbers. Those do not belong in source control — create them in
// the composer and paste the account line there.

import type { TemplateDraft } from "@/lib/whatsapp/templates";
import { DEFAULT_BRAND, type Brand } from "@/lib/brand";

export interface StarterTemplate extends TemplateDraft {
  label: string;
  note?: string;
}

/**
 * The delivery follow-up drafts, worded for one company's brand. Submitted to
 * Meta by submitStarterSet (actions.ts), which resolves the signed-in company's
 * brand first. Houzs (the default) is byte-identical to the copy already
 * approved on the Seampify WABA, including *bold* markers and emoji. The brand
 * is baked in here because a Meta template body cannot carry a runtime variable
 * for it — see lib/brand.ts.
 */
export function starterTemplates(brand: Brand = DEFAULT_BRAND): StarterTemplate[] {
  return [
  {
    label: "Delivery scheduled (1 order)",
    note: "The workhorse — 125 sends in the last week on Seampify.",
    name: "hc_order_delivery_follow_up_1_order",
    language: "en",
    category: "UTILITY",
    // Line breaks verified against the live Seampify editor, not the rendered
    // list (which collapses them) — the greeting is its own line.
    body: `Hi {{1}} 👋

Good news! Your order with ${brand.short} has been scheduled for delivery.

Reference No. : *{{2}}*
Delivery Date: *{{3}}*
Branding: *{{4}}*

We'll confirm the exact delivery time with you again before delivery.

Please tap *"Confirm Date"* if this works for you. If you need to reschedule, please tap *"Amend Date"* 👇`,
    examples: ["Wong", "znt7001", "12/08/2026", "Dunlopillo"],
    buttons: [
      { type: "QUICK_REPLY", text: "Confirm Date" },
      { type: "QUICK_REPLY", text: "Amend Date" },
    ],
  },
  {
    label: "Reschedule proposed (1 order)",
    name: "hc_order_amend_follow_up_1_order",
    language: "en",
    category: "UTILITY",
    body: `Hi {{1}} 👋

Due to some arrangements with goods and transportation, we'll need to reschedule your delivery time.
Our proposed new date is:

Reference No. : *{{2}}*
Delivery Date: *{{3}}*
Branding: *{{4}}*

Please confirm if this date works for you 👇
We'll confirm the exact time with you again a few days before delivery.

If you need to change it, just tap the button below — our team will be happy to assist.`,
    examples: ["Wong", "znt7001", "15/08/2026", "Dunlopillo"],
    buttons: [
      { type: "QUICK_REPLY", text: "Confirm Date" },
      { type: "QUICK_REPLY", text: "Amend Date" },
    ],
  },
  {
    label: "Delivered — thank you",
    name: "delivery_completed_thanks",
    // en_GB on the source WABA, not en — a different language code is a
    // different template as far as Meta is concerned.
    language: "en_GB",
    category: "UTILITY",
    body: `Hi {{1}}, This is a confirmation that your order {{2}} was successfully delivered today. Thank you for your understanding and for purchasing our products. We sincerely appreciate your support and are grateful for your trust in us. Please let us know if you have any questions or need further assistance with your items!`,
    examples: ["Wong", "znt7001"],
  },
  {
    label: "Re-open an expired conversation",
    note: "Used when the 24-hour window closed before the customer replied.",
    name: "after_24_hour_follow_up_message",
    language: "en",
    category: "UTILITY",
    body: `Hi {{1}}, We have received your enquiry, would you like to continue the conversation?`,
    examples: ["Wong"],
  },
  {
    label: "Ask for the delivery address",
    name: "ask_delivery_address",
    language: "en_GB",
    category: "UTILITY",
    body: `Hi {{1}} 👋 We're getting your ${brand.short} order *{{2}}* ready! 🚚

To help us arrange your delivery schedule and route smoothly, could you please reply to this message with your *full delivery address and postal code*?

Thank you so much! ✨`,
    examples: ["Wong", "znt7001"],
  },
  {
    label: "Order delayed",
    name: "overdue_order_status_update",
    language: "en_GB",
    category: "UTILITY",
    body: `Hi *{{1}}* , this is the Customer Service Team from ${brand.name}. We sincerely apologize for the delay with your order *{{2}}*. Due to *{{3}}*, your order requires additional time to ensure everything meets our standards. Our team is actively working on your items, and we expect to deliver your order within the next delivery timeframe *{{4}}*. Our logistics team will contact you shortly to confirm the exact date and time. Thank you for your patience and for giving us the opportunity to make this right.`,
    examples: ["Wong", "znt7001", "supplier delay", "end of August"],
  },
  ];
}

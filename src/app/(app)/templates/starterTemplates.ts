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
import type { VarBinding } from "@/lib/automation/vars";
import {
  THECONTS_CORE_TEMPLATES,
  contsBindings,
} from "@/lib/theconts/coreTemplates";

export interface StarterTemplate extends TemplateDraft {
  label: string;
  note?: string;
  /** The {{n}} -> field mapping to save alongside the Meta draft, so the
   *  manual/campaign send path resolves the body without a human re-picking
   *  every dropdown. Only the company-scoped sets (The Conts) carry it; the HC
   *  set binds in the campaign wizard, as it always has. */
  bindings?: VarBinding[];
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
  {
    label: "East Malaysia — prep notice",
    note: "Touchpoint 1 of the East Malaysia delivery flow. Info only — no amount or bank account.",
    name: "hc_eastmy_prep_notice",
    language: "en",
    category: "UTILITY",
    body: `Hi {{1}} 👋

Good news! We'll start preparing your ${brand.short} order *{{2}}* this week to next week. After that, our transporter will arrange sea freight to East Malaysia 🚢

🕒 Estimated arrival at {{3}} port: around *2–3 weeks* after dispatch.

Once it arrives and is unloaded at the port, we'll collect the balance payment — then our transporter will contact you to arrange delivery to your door 🚚

If everything's clear, tap *"Noted"*. If you have any questions, tap *"I have a question"* 👇`,
    examples: ["Wong", "znt7001", "Kota Kinabalu"],
    buttons: [
      { type: "QUICK_REPLY", text: "Noted" },
      { type: "QUICK_REPLY", text: "I have a question" },
    ],
  },
  {
    label: "East Malaysia — shipped / tracking",
    note: "Touchpoint 2. One-way 'on its way' notice with forwarder + tracking no. + ETA.",
    name: "hc_eastmy_shipped",
    language: "en",
    category: "UTILITY",
    body: `Hi {{1}} 👋 Your order *{{2}}* is now on its way to East Malaysia by sea freight 🚢

Forwarder: *{{3}}*
Consignment / Tracking No.: *{{4}}*
Estimated arrival at {{5}} port: *{{6}}*

We'll notify you again once it arrives and is ready for the next step. Thank you for your patience! ✨`,
    examples: ["Wong", "znt7001", "Swift Cargo", "SC123456", "Kota Kinabalu", "early Dec"],
  },
  {
    label: "East Malaysia — arrived at port",
    note: "Touchpoint 3. 'Arrived & unloaded' notice; the transporter then contacts the customer for home delivery.",
    name: "hc_eastmy_arrived",
    language: "en",
    category: "UTILITY",
    body: `Hi {{1}} 👋 Great news — your order *{{2}}* has arrived at {{3}} port and is being unloaded 📦

Our transporter will contact you shortly to arrange delivery to your door 🚚

Thank you for your patience! ✨`,
    examples: ["Wong", "znt7001", "Kota Kinabalu"],
  },
  ];
}

/**
 * The Conts' core-subset guest-messaging drafts (Skyline KL), built from the one
 * source of truth in lib/theconts/coreTemplates.ts. Bodies are verbatim from the
 * build spec; each carries its {{n}} -> field binding so submitStarterSet saves
 * the mapping when it submits. The Conts' copy has no brand variable (the
 * property name is baked into each body), so unlike the Houzs set this takes no
 * Brand.
 */
export function thecontsStarterTemplates(): StarterTemplate[] {
  return THECONTS_CORE_TEMPLATES.map((t) => ({
    label: t.automationName,
    name: t.templateName,
    language: t.language,
    category: t.category,
    body: t.body,
    examples: t.examples,
    bindings: contsBindings(t),
  }));
}

/**
 * The starter set for a company, chosen by slug. The Conts gets its own
 * guest-messaging subset; every other company keeps the Houzs delivery set,
 * worded for its brand (Houzs by default) exactly as before.
 */
export function starterSetForSlug(
  slug: string | null | undefined,
  brand: Brand = DEFAULT_BRAND
): StarterTemplate[] {
  if (slug === "the-conts") return thecontsStarterTemplates();
  return starterTemplates(brand);
}

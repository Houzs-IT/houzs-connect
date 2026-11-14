// The Conts — core-subset guest-messaging templates (single source of truth).
//
// GENERATED ONCE from the owner-approved build spec
// (theconts-template-build-spec.md, 2026-11-14) and then hand-maintained.
// Bodies are VERBATIM from StreamHost's CS-confirmed Skyline KL picks, with the
// named variables already converted to positional {{1}}..{{n}} by the spec.
//
// This core subset (4 of the eventual 41) validates the whole ERP -> Connect ->
// Meta chain across the common variable signatures before the full set is built:
//   - check-in / access-details (7 vars: the full door + wifi + mailbox set)
//   - check-out                 (3 vars: unit + mailbox + lockbox)
//   - facilities / welcome      (3 vars: name + check-in/out dates)
//   - quiet-hours notice        (2 vars: name + unit)
//
// ONE obvious spot for the {{n}} -> field mapping (the spec's open ⚑ items):
// each template's `vars` below is the single mapping used EVERYWHERE — the Meta
// draft's example order (submitStarterSet), the manual/campaign send path's
// saved binding (saveTemplateBinding), and the ERP fire-on-push automation's
// params (lib/automation/flows/theconts.ts). Change a mapping here and all three
// stay in step. Field keys match The Conts' live Connect contact fields and the
// attribute keys the ERP injects (theconts-erp-connect-push-spec.md §7):
//   unit_no, mailbox, mailbox_no, mailbox_passcode, maindoor, maindoor2,
//   wifi, wifi_username, checkin_date, checkout_date  (+ builtin full_name).
//
// This core subset does NOT use mailbox_no / mailbox_passcode: those ride the
// Regalia / Lavile templates, whose credential-kind mapping is still an open CS
// question (spec §"Before SUBMITTING" + PR #957 TODO), so they are left to the
// full build. Dates are sent pre-formatted by the ERP (Connect does no date
// formatting).

import type { VarBinding } from "@/lib/automation/vars";

export type ContsVarSource = "builtin" | "field";

/** One {{n}} slot's mapping: where its value comes from. */
export interface ContsVar {
  /** The {{n}} this fills — 1-based, as Meta numbers its body parameters. */
  slot: number;
  /** "builtin" => a BUILT_IN_FIELDS key (full_name); "field" => a contact-field key. */
  source: ContsVarSource;
  /** full_name for a builtin; the contact-field key otherwise. */
  key: string;
  /** Human label for the slot (Connect's field display name). Display only. */
  label: string;
}

/** A core-subset template, with everything the three send paths need. */
export interface ContsTemplateDef {
  /** Stable handle (also the Meta template name). */
  key: string;
  /** Meta template name — `theconts_`-prefixed so it scopes to The Conts on the
   *  shared WABA (lib/whatsapp/templateCompany.ts classifies by the name). */
  templateName: string;
  language: "en";
  category: "UTILITY";
  /** Automation name — the value the ERP sends as `automation` (CONNECT_AUTOMATIONS). */
  automationName: string;
  /** Snake-case id recorded in the WEBHOOK trigger config (metadata, not matched). */
  automationEvent: string;
  automationDescription: string;
  /** One Meta sample value per {{n}}, in slot order (from the spec's sample table). */
  examples: string[];
  /** The {{n}} -> field mapping, in slot order. */
  vars: ContsVar[];
  /** Body copy, VERBATIM from the spec, with positional {{1}}..{{n}}. */
  body: string;
}

export const THECONTS_CORE_TEMPLATES: ContsTemplateDef[] = [
  {
    key: "theconts_skyline_checkin",
    templateName: "theconts_skyline_checkin",
    language: "en",
    category: "UTILITY",
    automationName: "The Conts Check-in (Skyline KL)",
    automationEvent: "theconts_skyline_checkin",
    automationDescription:
      "Sends the Skyline KL check-in / access-details template (theconts_skyline_checkin): full name + unit, mailbox, lockbox (maindoor2), main door (maindoor), wifi username + wifi.",
    examples: ["Jia Wei","A-12-03","1234","188","5678","TheConts_A1203","houzswifi123"],
    vars: [
      { slot: 1, source: "builtin", key: "full_name", label: "Full Name" },
      { slot: 2, source: "field", key: "unit_no", label: "Unit No" },
      { slot: 3, source: "field", key: "mailbox", label: "Mailbox" },
      { slot: 4, source: "field", key: "maindoor2", label: "Maindoor2" },
      { slot: 5, source: "field", key: "maindoor", label: "Maindoor" },
      { slot: 6, source: "field", key: "wifi_username", label: "Wifi Username" },
      { slot: 7, source: "field", key: "wifi", label: "Wifi" },
    ],
    body: `Welcome to THE CONTS HOMESTAY
Dear {{1}}

*PLEASE DO NOT MENTION AIRBNB / HOMESTAY*

🏠 Unit Number: *{{2}}*

*Mailbox access: {{3}}*
*Lockbox access: {{4}}*
*Main door access: {{5}}*
*Wifi: {{6}}*
*Wifi access: {{7}}*

🚗 Address : Jalan San Peng, Pudu, 55200, Kuala Lumpur, Wilayah Persekutuan Kuala Lumpur.

📍 Google Map Link : https://share.google/k6e1COpfi8cgOLUrv

🚘 Waze Link : https://waze.com/ul/hw283fd883

Here's our service group during your stay. Please Feel free to direct message through here if you do have difficulty or need any assistance. 🥰

*Please take note you can only check in after 3pm as the room is still under cleaning.*

Once check in completed please Inform us too ya.🥰

Please let us know If you need any further assistance.

Thank You 🥰`,
  },
  {
    key: "theconts_skyline_checkout",
    templateName: "theconts_skyline_checkout",
    language: "en",
    category: "UTILITY",
    automationName: "The Conts Check-out (Skyline KL)",
    automationEvent: "theconts_skyline_checkout",
    automationDescription:
      "Sends the Skyline KL check-out instruction template (theconts_skyline_checkout): unit, mailbox, lockbox (maindoor2).",
    examples: ["A-12-03","1234","188"],
    vars: [
      { slot: 1, source: "field", key: "unit_no", label: "Unit No" },
      { slot: 2, source: "field", key: "mailbox", label: "Mailbox" },
      { slot: 3, source: "field", key: "maindoor2", label: "Maindoor2" },
    ],
    body: `Check Out @ Skyline KL
*Here is the check out instruction for {{1}}*.

*1.Before check-out* ⭐️
•⁠  ⁠Ensure all your belongings are taken with you.
•⁠  ⁠Switch off the Aircons, Fan & Lights in the unit.

*2.If you are driving a vehicle*
•⁠  ⁠Exit the gate first & then walk back to the mailbox room.

*3.Key & Access Card Return⭐*
•⁠  ⁠Leave the 2 access cards in the correct mailbox 📬{{1}}
- Mailbox Access
{{2}}
- Lockbox Access
{{3}}

*4.Verification of Return⭐*
•⁠  ⁠Take a picture of the keys in the mailbox with the unit number.
•⁠  ⁠Lock the mailbox & send the picture to us to confirm check-out.

Small reminder 💭: Check-out must be completed before *11am* to avoid any penalty charges.`,
  },
  {
    key: "theconts_skyline_facilities",
    templateName: "theconts_skyline_facilities",
    language: "en",
    category: "UTILITY",
    automationName: "The Conts Facilities (Skyline KL)",
    automationEvent: "theconts_skyline_facilities",
    automationDescription:
      "Sends the Skyline KL facilities / welcome template (theconts_skyline_facilities): full name + check-in and check-out dates.",
    examples: ["Jia Wei","15 Nov 2026","18 Nov 2026"],
    vars: [
      { slot: 1, source: "builtin", key: "full_name", label: "Full Name" },
      { slot: 2, source: "field", key: "checkin_date", label: "Check-in Date" },
      { slot: 3, source: "field", key: "checkout_date", label: "Check-out Date" },
    ],
    body: `Facility @ Skyline KL
Hi {{1}}, your stay at Skyline KL is from {{2}} to {{3}} 😊

Here is some useful information regarding the property facilities:

🏊 Swimming Pool
📍 Level 9 Podium
🕘 Operating Hours: 7AM – 10PM`,
  },
  {
    key: "theconts_quiet_hours_notice",
    templateName: "theconts_quiet_hours_notice",
    language: "en",
    category: "UTILITY",
    automationName: "The Conts Quiet Hours",
    automationEvent: "theconts_quiet_hours",
    automationDescription:
      "Sends the quiet-hours reminder template (theconts_quiet_hours_notice): full name + unit.",
    examples: ["Jia Wei","A-12-03"],
    vars: [
      { slot: 1, source: "builtin", key: "full_name", label: "Full Name" },
      { slot: 2, source: "field", key: "unit_no", label: "Unit No" },
    ],
    body: `Important Notice

Hello {{1}},

As a reminder, *quiet hours are from 11 PM to 7 AM*. Please keep noise to a minimum to respect other guests.

Your unit: {{2}}

Thank you for your cooperation!`,
  },
];

/** A slot's {key} interpolation token — the same for builtin and field, since
 *  interpolate()/buildLookup() resolve full_name and attribute keys uniformly. */
function token(v: ContsVar): string {
  return `{${v.key}}`;
}

/** The send_template params for the fire-on-push automation: one {key} token per
 *  {{n}}, in slot order. Interpolated per contact by the engine at send time. */
export function contsFlowParams(def: ContsTemplateDef): string[] {
  return [...def.vars].sort((a, b) => a.slot - b.slot).map(token);
}

/** The DEMO / inbox-preview message: the body with every {{n}} swapped for its
 *  {key} token, so the simulator and a template Meta's list cannot give us still
 *  render the real sentence. */
export function contsDemoMessage(def: ContsTemplateDef): string {
  return def.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => {
    const v = def.vars.find((x) => x.slot === Number(n));
    return v ? token(v) : m;
  });
}

/** The saved {{n}} -> field mapping for the manual/campaign send path
 *  (saveTemplateBinding). full_name is a builtin; the rest are contact fields. */
export function contsBindings(def: ContsTemplateDef): VarBinding[] {
  return [...def.vars]
    .sort((a, b) => a.slot - b.slot)
    .map((v) => ({ index: v.slot, source: v.source, key: v.key, label: v.label }));
}

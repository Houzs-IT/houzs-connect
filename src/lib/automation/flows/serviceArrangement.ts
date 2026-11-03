import type { SeedFlow } from "./types";
import {
  DATE_FORM_KEY,
  ERP_CALLBACK_HEADERS,
  OPENER_AMEND_BTN,
  OPENER_CONFIRM_BTN,
  SHARED_FORMS,
  TYPE_DATE,
} from "./shared";

/**
 * Service Arrangement — the after-sales (ASSR) date conversation (HC-0171).
 *
 * The ERP fires this (by name, trigger WEBHOOK) from the Delivery Planning board
 * for ONE leg of a Service Case: a furniture pickup, an inspection visit or the
 * return delivery. The customer confirms the date or asks for another one, and
 * the answer goes back to the ERP's /api/chat-callback with `leg`, which records
 * it on the case timeline (it never moves the date — Logistics does).
 *
 * Not the shared delivery graph: that one goes on to the balance nudge, the
 * Property Details form and the disposal fee, none of which a service visit
 * has. It keeps the same confirm-lock attribute (button_status) and reuses the
 * published "New Delivery Date" form, so nothing new needs publishing on Meta
 * except the opener template.
 *
 * Opener template hc_service_arrangement (UTILITY, en) — Confirm Date / Amend
 * Date quick replies, 4 vars: full_name, the case number (ref_1), the job
 * (service_job: "furniture pickup" / "inspection visit" / "return delivery") and
 * the date (delivery_date_1). The ERP also sends assr_leg, echoed as `leg`.
 */

const OPENING = `Hi {full_name}, this is Houzs Century about your service case *{ref_1}*.

We have arranged the *{service_job}* on *{delivery_date_1}*.

Please tap "Confirm Date" if this works for you. If you need another date, please tap "Amend Date".`;

const CONFIRM_THANKS = `Thank you for confirming! Our team will contact you again before the visit if anything changes.`;

const LOCKED = `This date is already confirmed. If you need to change it, please reply here and our team will assist you.`;

const AMEND_START = `No problem, we can help you find another date. May I know the reason for the change?`;

const CHOOSE_DATE = `Please choose your preferred date.

_Our team will review it against the service schedule and confirm with you._`;

const CONFIRM_NEW_DATE = `For your service case *{ref_1}*, is this the correct preferred date?

New Date: *{amended_delivery_date}*`;

const AMEND_SUBMITTED = `Thank you! We have received your preferred date. Our team will review it and contact you to confirm the final arrangement.`;

const callbackBody = (event: "confirm" | "amend") =>
  event === "confirm"
    ? `{"callback_id":"{run_id}-confirm","event":"confirm","ref":"{ref_1}","leg":"{assr_leg}","phone":"{phone}","note":"source=connect"}`
    : `{"callback_id":"{run_id}-amend","event":"amend","ref":"{ref_1}","leg":"{assr_leg}","phone":"{phone}","delivery_date":"{amended_delivery_date}","reason":"{amend_date_reason}","note":"source=connect"}`;

export const serviceArrangementFlow: SeedFlow = {
  key: "service_arrangement",
  // MUST equal the ERP's KIND_AUTOMATION.assr_arrangement
  // (Houzs-ERP backend/src/scm/lib/delivery-message-kinds.ts).
  name: "Service Arrangement",
  description:
    "ASSR (after-sales) date conversation: one Service Case leg (pickup / inspection / return delivery), confirm or amend, ERP callback with the leg.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "service_arrangement" },
  forms: SHARED_FORMS.filter((f) => f.key === DATE_FORM_KEY),
  build: (formIds) => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 320 },
      {
        id: "ask_date",
        type: "send_template",
        x: 240,
        y: 320,
        data: {
          templateName: "hc_service_arrangement",
          templateLang: "en",
          templateParams: ["{full_name}", "{ref_1}", "{service_job}", "{delivery_date_1}"],
          message: OPENING,
          buttons: [
            { id: OPENER_CONFIRM_BTN, label: OPENER_CONFIRM_BTN },
            { id: OPENER_AMEND_BTN, label: OPENER_AMEND_BTN },
          ],
        },
      },

      // ── Confirm ──
      { id: "set_confirm", type: "set_attribute", x: 480, y: 120, data: { key: "button_status", value: "Confirm" } },
      { id: "tag_sched", type: "add_tag", x: 700, y: 120, data: { tag: "service scheduling" } },
      {
        id: "cb_confirm",
        type: "call_rest_api",
        x: 920,
        y: 120,
        data: { method: "POST", url: "{callback_url}", headers: ERP_CALLBACK_HEADERS, body: callbackBody("confirm") },
      },
      { id: "thanks_confirm", type: "send_text", x: 1140, y: 120, data: { message: CONFIRM_THANKS } },
      { id: "confirm_end", type: "end", x: 1360, y: 120, data: {} },

      // ── Amend ──
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
      {
        id: "ask_reason",
        type: "ask_buttons",
        x: 920,
        y: 620,
        data: {
          message: AMEND_START,
          buttons: [
            { id: "date_unavail", label: "Date Unavailable" },
            { id: "not_home", label: "Not At Home" },
          ],
        },
      },
      { id: "reason_unavail", type: "set_attribute", x: 1140, y: 540, data: { key: "amend_date_reason", value: "Date Unavailable" } },
      { id: "reason_not_home", type: "set_attribute", x: 1140, y: 700, data: { key: "amend_date_reason", value: "Not At Home" } },
      {
        id: "ask_new_date",
        type: "send_form",
        x: 1360,
        y: 620,
        data: { formId: formIds[DATE_FORM_KEY], flowCta: "Choose date", message: CHOOSE_DATE },
      },
      {
        id: "date_router",
        type: "criteria_router",
        x: 1470,
        y: 620,
        data: { rules: [{ branch: "have_date", field: "amended_delivery_date", op: "set" }] },
      },
      { id: "type_new_date", type: "collect_input", x: 1470, y: 760, data: { message: TYPE_DATE, saveTo: "amended_delivery_date" } },
      { id: "clear_new_date", type: "set_attribute", x: 1580, y: 760, data: { key: "amended_delivery_date", value: "" } },
      {
        id: "confirm_new_date",
        type: "ask_buttons",
        x: 1580,
        y: 620,
        data: {
          message: CONFIRM_NEW_DATE,
          buttons: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      },
      { id: "tag_resched", type: "add_tag", x: 1800, y: 620, data: { tag: "service reschedule" } },
      {
        id: "cb_amend",
        type: "call_rest_api",
        x: 2020,
        y: 620,
        data: { method: "POST", url: "{callback_url}", headers: ERP_CALLBACK_HEADERS, body: callbackBody("amend") },
      },
      { id: "amend_submitted", type: "send_text", x: 2240, y: 620, data: { message: AMEND_SUBMITTED } },
      { id: "amend_end", type: "end", x: 2460, y: 620, data: {} },
    ],
    edges: [
      { from: "trigger", to: "ask_date" },
      { from: "ask_date", to: "set_confirm", branch: OPENER_CONFIRM_BTN },
      { from: "ask_date", to: "amend_guard", branch: OPENER_AMEND_BTN },

      { from: "set_confirm", to: "tag_sched" },
      { from: "tag_sched", to: "cb_confirm" },
      { from: "cb_confirm", to: "thanks_confirm" },
      { from: "thanks_confirm", to: "confirm_end" },

      { from: "amend_guard", to: "locked_msg", branch: "locked" },
      { from: "amend_guard", to: "set_amend", branch: "default" },
      { from: "locked_msg", to: "locked_end" },
      { from: "set_amend", to: "ask_reason" },
      { from: "ask_reason", to: "reason_unavail", branch: "date_unavail" },
      { from: "ask_reason", to: "reason_not_home", branch: "not_home" },
      { from: "reason_unavail", to: "ask_new_date" },
      { from: "reason_not_home", to: "ask_new_date" },
      { from: "ask_new_date", to: "date_router" },
      { from: "date_router", to: "confirm_new_date", branch: "have_date" },
      { from: "date_router", to: "type_new_date", branch: "default" },
      { from: "type_new_date", to: "confirm_new_date" },
      { from: "confirm_new_date", to: "tag_resched", branch: "yes" },
      { from: "confirm_new_date", to: "clear_new_date", branch: "no" },
      { from: "clear_new_date", to: "ask_new_date" },
      { from: "tag_resched", to: "cb_amend" },
      { from: "cb_amend", to: "amend_submitted" },
      { from: "amend_submitted", to: "amend_end" },
    ],
  }),
};

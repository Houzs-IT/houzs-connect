import type { FlowEdge, FlowNode } from "../types";
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
 * for ONE leg of a Service Case: a service item pickup, an inspection visit or a
 * service item delivery. The customer confirms the date or asks for another one,
 * and the answer goes back to the ERP's /api/chat-callback with `leg`, which
 * records it on the case timeline (it never moves the date — Logistics does).
 *
 * Not the shared delivery graph: that one goes on to the balance nudge, the
 * Property Details form and the disposal fee, none of which a service visit
 * has. It keeps the same confirm-lock attribute (button_status) and reuses the
 * published "New Delivery Date" form, so nothing new needs publishing on Meta
 * except the opener template.
 *
 * The confirm/amend conversation itself (everything after the opener) is shared
 * with the service-case POSTPONE send via `buildServiceDateGraph` below — same
 * leg callback, same lock, same amend sub-flow — so the only thing that differs
 * between "we have arranged" and "we need to postpone" is the opener template.
 *
 * Opener template hc_service_arrangement (UTILITY, en) — Confirm Date / Amend
 * Date quick replies, 5 vars, in this order: {{1}} full_name, {{2}} the case
 * number (assr_no), {{3}} the Sales Order number (ref_2), {{4}} the job
 * (service_job: "service item pickup" / "inspection visit" / "service item
 * delivery") and {{5}} the date (delivery_date_1). The template body must keep
 * exactly these 5 slots — a param-count mismatch leaves a literal "{{5}}" in the
 * customer's message and shifts every value one slot. The ERP also sends
 * assr_leg (echoed as `leg`) and ref_1 (the case number the callback echoes
 * back as `ref`); both stay on the contact for the callback but are NOT
 * template params.
 *
 * The three service_job values are written by the ERP (sole writer:
 * ASSR_LEG_CUSTOMER_LABEL in backend/src/scm/lib/assr-arrangement-message.ts),
 * so this flow only reads the {service_job} variable — changing the wording is
 * an ERP-side change and needs no Meta re-approval here.
 */

const OPENING = `Hi {full_name}, this is Houzs Century about your service case {assr_no}.
(SO Number: {ref_2})

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

/**
 * The after-sales confirm/amend conversation, WITHOUT a trigger, so the caller
 * wires the entry node (`entry`) to whatever precedes it: Service Arrangement
 * puts a trigger straight onto it; the Postpone flow routes into it from a
 * service_job criteria_router (the SO-delivery branch keeps the delivery graph).
 *
 * Only the opener (template + params + copy) differs between the two callers;
 * the confirm tail, the confirm-lock, the amend sub-flow and the ERP leg
 * callback are identical. `prefix` namespaces every node id so the subgraph can
 * be embedded alongside another graph without an id collision; `yOffset` shifts
 * it on the canvas for the same reason.
 */
export function buildServiceDateGraph(opts: {
  opening: string;
  openerTemplate: string;
  openerParams: string[];
  formIds: Record<string, string>;
  prefix?: string;
  yOffset?: number;
}): { nodes: FlowNode[]; edges: FlowEdge[]; entry: string } {
  const { opening, openerTemplate, openerParams, formIds } = opts;
  const p = opts.prefix ?? "";
  const yo = opts.yOffset ?? 0;
  const id = (s: string) => `${p}${s}`;

  const nodes: FlowNode[] = [
    {
      id: id("ask_date"),
      type: "send_template",
      x: 240,
      y: 320 + yo,
      data: {
        templateName: openerTemplate,
        templateLang: "en",
        templateParams: openerParams,
        message: opening,
        buttons: [
          { id: OPENER_CONFIRM_BTN, label: OPENER_CONFIRM_BTN },
          { id: OPENER_AMEND_BTN, label: OPENER_AMEND_BTN },
        ],
      },
    },

    // ── Confirm ──
    { id: id("set_confirm"), type: "set_attribute", x: 480, y: 120 + yo, data: { key: "button_status", value: "Confirm" } },
    { id: id("tag_sched"), type: "add_tag", x: 700, y: 120 + yo, data: { tag: "service scheduling" } },
    {
      id: id("cb_confirm"),
      type: "call_rest_api",
      x: 920,
      y: 120 + yo,
      data: { method: "POST", url: "{callback_url}", headers: ERP_CALLBACK_HEADERS, body: callbackBody("confirm") },
    },
    { id: id("thanks_confirm"), type: "send_text", x: 1140, y: 120 + yo, data: { message: CONFIRM_THANKS } },
    { id: id("confirm_end"), type: "end", x: 1360, y: 120 + yo, data: {} },

    // ── Amend ──
    {
      id: id("amend_guard"),
      type: "criteria_router",
      x: 480,
      y: 520 + yo,
      data: { rules: [{ branch: "locked", field: "button_status", op: "eq", value: "Confirm" }] },
    },
    { id: id("locked_msg"), type: "send_text", x: 700, y: 420 + yo, data: { message: LOCKED } },
    { id: id("locked_end"), type: "end", x: 920, y: 420 + yo, data: {} },
    { id: id("set_amend"), type: "set_attribute", x: 700, y: 620 + yo, data: { key: "button_status", value: "Amend" } },
    {
      id: id("ask_reason"),
      type: "ask_buttons",
      x: 920,
      y: 620 + yo,
      data: {
        message: AMEND_START,
        buttons: [
          { id: "date_unavail", label: "Date Unavailable" },
          { id: "not_home", label: "Not At Home" },
        ],
      },
    },
    { id: id("reason_unavail"), type: "set_attribute", x: 1140, y: 540 + yo, data: { key: "amend_date_reason", value: "Date Unavailable" } },
    { id: id("reason_not_home"), type: "set_attribute", x: 1140, y: 700 + yo, data: { key: "amend_date_reason", value: "Not At Home" } },
    {
      id: id("ask_new_date"),
      type: "send_form",
      x: 1360,
      y: 620 + yo,
      data: { formId: formIds[DATE_FORM_KEY], flowCta: "Choose date", message: CHOOSE_DATE },
    },
    {
      id: id("date_router"),
      type: "criteria_router",
      x: 1470,
      y: 620 + yo,
      data: { rules: [{ branch: "have_date", field: "amended_delivery_date", op: "set" }] },
    },
    { id: id("type_new_date"), type: "collect_input", x: 1470, y: 760 + yo, data: { message: TYPE_DATE, saveTo: "amended_delivery_date" } },
    { id: id("clear_new_date"), type: "set_attribute", x: 1580, y: 760 + yo, data: { key: "amended_delivery_date", value: "" } },
    {
      id: id("confirm_new_date"),
      type: "ask_buttons",
      x: 1580,
      y: 620 + yo,
      data: {
        message: CONFIRM_NEW_DATE,
        buttons: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
    },
    { id: id("tag_resched"), type: "add_tag", x: 1800, y: 620 + yo, data: { tag: "service reschedule" } },
    {
      id: id("cb_amend"),
      type: "call_rest_api",
      x: 2020,
      y: 620 + yo,
      data: { method: "POST", url: "{callback_url}", headers: ERP_CALLBACK_HEADERS, body: callbackBody("amend") },
    },
    { id: id("amend_submitted"), type: "send_text", x: 2240, y: 620 + yo, data: { message: AMEND_SUBMITTED } },
    { id: id("amend_end"), type: "end", x: 2460, y: 620 + yo, data: {} },
  ];

  const edges: FlowEdge[] = [
    { from: id("ask_date"), to: id("set_confirm"), branch: OPENER_CONFIRM_BTN },
    { from: id("ask_date"), to: id("amend_guard"), branch: OPENER_AMEND_BTN },

    { from: id("set_confirm"), to: id("tag_sched") },
    { from: id("tag_sched"), to: id("cb_confirm") },
    { from: id("cb_confirm"), to: id("thanks_confirm") },
    { from: id("thanks_confirm"), to: id("confirm_end") },

    { from: id("amend_guard"), to: id("locked_msg"), branch: "locked" },
    { from: id("amend_guard"), to: id("set_amend"), branch: "default" },
    { from: id("locked_msg"), to: id("locked_end") },
    { from: id("set_amend"), to: id("ask_reason") },
    { from: id("ask_reason"), to: id("reason_unavail"), branch: "date_unavail" },
    { from: id("ask_reason"), to: id("reason_not_home"), branch: "not_home" },
    { from: id("reason_unavail"), to: id("ask_new_date") },
    { from: id("reason_not_home"), to: id("ask_new_date") },
    { from: id("ask_new_date"), to: id("date_router") },
    { from: id("date_router"), to: id("confirm_new_date"), branch: "have_date" },
    { from: id("date_router"), to: id("type_new_date"), branch: "default" },
    { from: id("type_new_date"), to: id("confirm_new_date") },
    { from: id("confirm_new_date"), to: id("tag_resched"), branch: "yes" },
    { from: id("confirm_new_date"), to: id("clear_new_date"), branch: "no" },
    { from: id("clear_new_date"), to: id("ask_new_date") },
    { from: id("tag_resched"), to: id("cb_amend") },
    { from: id("cb_amend"), to: id("amend_submitted") },
    { from: id("amend_submitted"), to: id("amend_end") },
  ];

  return { nodes, edges, entry: id("ask_date") };
}

export const serviceArrangementFlow: SeedFlow = {
  key: "service_arrangement",
  // MUST equal the ERP's KIND_AUTOMATION.assr_arrangement
  // (Houzs-ERP backend/src/scm/lib/delivery-message-kinds.ts).
  name: "Service Arrangement",
  description:
    "ASSR (after-sales) date conversation: one Service Case leg (service item pickup / inspection visit / service item delivery), confirm or amend, ERP callback with the leg.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "service_arrangement" },
  forms: SHARED_FORMS.filter((f) => f.key === DATE_FORM_KEY),
  build: (formIds) => {
    const g = buildServiceDateGraph({
      opening: OPENING,
      openerTemplate: "hc_service_arrangement",
      openerParams: ["{full_name}", "{assr_no}", "{ref_2}", "{service_job}", "{delivery_date_1}"],
      formIds,
    });
    return {
      nodes: [{ id: "trigger", type: "trigger", data: {}, x: 40, y: 320 }, ...g.nodes],
      edges: [{ from: "trigger", to: g.entry }, ...g.edges],
    };
  },
};

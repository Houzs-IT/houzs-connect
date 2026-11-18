import type { FlowGraph } from "../types";
import type { SeedFlow } from "./types";
import { buildDeliveryGraph, SHARED_FORMS } from "./shared";
import { buildServiceDateGraph } from "./serviceArrangement";

/**
 * Postpone — an ERP-initiated postponement (decision B).
 *
 * When our side must push a confirmed delivery, the ERP fires this (by name,
 * trigger WEBHOOK); the opener proposes a revised date and the customer confirms
 * or amends. Same downstream as New Amend — it reuses the shared delivery graph
 * (confirm-lock, balance, Property form, amend sub-flow, ERP callback) with the
 * postpone template as the opener.
 *
 * Opener template hc_order_postpone_reason has Confirm Date / Amend Date quick
 * replies (so the shared graph's button routing applies unchanged) and 4 vars:
 * full_name, the scheduled date, the postpone reason, and the proposed new date.
 * Those last three are ERP-injected on the postpone trigger (go-live checklist).
 *
 * Two shapes exist under the SAME automation name "Postpone" (the ERP fires one
 * event for both):
 *  - `postponeFlow` — the plain delivery postpone. 2990 uses this one.
 *  - `postponeServiceFlow` — Houzs's, which routes a Service Case leg (the ERP
 *    sets `service_job` on those sends, same as Service Arrangement) into the
 *    service confirm/amend graph with a job-aware opener (hc_service_postpone),
 *    and falls back to the UNCHANGED delivery graph for a normal SO delivery
 *    (no service_job). It is NOT given to 2990: 2990 has no service cases, and
 *    hc_service_postpone is a Houzs-only template (templateGaps would skip it).
 */

const OPENING = `Dear {full_name} 👋 Apologies from {company_signature}. We're contacting you about your delivery scheduled for *{client_delivery_date}*.

We need to postpone it due to *{amend_date_reason_2}*.

Our team has tentatively rescheduled your delivery for *{new_delivery_date}*.

Please tap *"Confirm Date"* if this new date works for you. If you'd prefer a different date, tap *"Amend Date"* and we'll arrange a more convenient time 👇`;

// Service-case opener (mirrors the Meta-approved hc_service_postpone body): the
// one word that differs from a delivery postpone is the job, filled from
// {service_job} ("service item pickup" / "inspection visit" / "service item
// delivery"), so a pickup or inspection leg no longer reads as a "delivery".
const SERVICE_OPENING = `Dear {full_name} 👋 Apologies from Houzs Century. We're contacting you about your *{service_job}* scheduled for *{client_delivery_date}*.

We need to postpone it due to *{amend_date_reason_2}*, and our team has tentatively rescheduled it for *{new_delivery_date}*.

Please tap *"Confirm Date"* if this new date works for you. If you'd prefer a different date, tap *"Amend Date"* and we'll arrange a more convenient time 👇`;

const DELIVERY_OPENER_PARAMS = ["{full_name}", "{client_delivery_date}", "{amend_date_reason_2}", "{new_delivery_date}"];

export const postponeFlow: SeedFlow = {
  key: "postpone",
  name: "Postpone",
  description:
    "ERP-initiated postponement: propose a revised date (hc_order_postpone_reason), confirm or amend, with the shared tail, confirm-lock and ERP callback.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "postpone" },
  forms: SHARED_FORMS,
  build: (formIds) =>
    buildDeliveryGraph({
      opening: OPENING,
      openerTemplate: "hc_order_postpone_reason",
      openerParams: DELIVERY_OPENER_PARAMS,
      formIds,
    }),
};

// Houzs's service-aware Postpone: service_job set → service confirm/amend graph
// (hc_service_postpone opener, leg callback — same contract as Service
// Arrangement); otherwise the delivery postpone, byte-identical to postponeFlow.
export const postponeServiceFlow: SeedFlow = {
  key: "postpone",
  name: "Postpone",
  description:
    "ERP-initiated postponement, job-type-aware: a Service Case leg (service_job set) uses the service opener (hc_service_postpone) + leg callback; a normal SO delivery keeps the delivery postpone unchanged.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "postpone" },
  forms: SHARED_FORMS,
  build: (formIds): FlowGraph => {
    const delivery = buildDeliveryGraph({
      opening: OPENING,
      openerTemplate: "hc_order_postpone_reason",
      openerParams: DELIVERY_OPENER_PARAMS,
      formIds,
    });
    const service = buildServiceDateGraph({
      opening: SERVICE_OPENING,
      openerTemplate: "hc_service_postpone",
      openerParams: ["{full_name}", "{service_job}", "{client_delivery_date}", "{amend_date_reason_2}", "{new_delivery_date}"],
      formIds,
      prefix: "svc_",
      yOffset: 1000,
    });
    // Reuse the delivery graph untouched, minus its trigger: the job router now
    // feeds its entry (ask_date) on the default (SO) branch.
    const deliveryNodes = delivery.nodes.filter((n) => n.type !== "trigger");
    const deliveryEdges = delivery.edges.filter((e) => e.from !== "trigger");
    return {
      nodes: [
        { id: "trigger", type: "trigger", data: {}, x: 40, y: 320 },
        // Routes on service_job PRESENCE — correct only while service_job is set
        // iff this send is a service-case leg. The ERP webhook MERGES attributes
        // (dispatch.ts), and a prior Service Arrangement leaves service_job on the
        // contact, so the ERP must send service_job empty on an SO postpone to
        // clear it; otherwise an SO postpone for a past service-case customer
        // would misroute here. (ERP go-live prerequisite.)
        {
          id: "job_router",
          type: "criteria_router",
          x: 140,
          y: 320,
          data: { rules: [{ branch: "service", field: "service_job", op: "set" }] },
        },
        ...deliveryNodes,
        ...service.nodes,
      ],
      edges: [
        { from: "trigger", to: "job_router" },
        { from: "job_router", to: service.entry, branch: "service" },
        { from: "job_router", to: "ask_date", branch: "default" },
        ...deliveryEdges,
        ...service.edges,
      ],
    };
  },
};

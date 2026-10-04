import type { SeedFlow } from "./types";
import { buildDeliveryGraph, SHARED_FORMS } from "./shared";

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
 */

const OPENING = `Dear {full_name} 👋 Apologies from Houzs Century. We're contacting you about your delivery scheduled for *{client_delivery_date}*.

We need to postpone it due to *{amend_date_reason_2}*.

Our team has tentatively rescheduled your delivery for *{new_delivery_date}*.

Please tap *"Confirm Date"* if this new date works for you. If you'd prefer a different date, tap *"Amend Date"* and we'll arrange a more convenient time 👇`;

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
      openerParams: ["{full_name}", "{client_delivery_date}", "{amend_date_reason_2}", "{new_delivery_date}"],
      formIds,
    }),
};

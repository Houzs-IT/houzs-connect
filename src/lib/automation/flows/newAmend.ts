import type { SeedFlow } from "./types";
import { buildDeliveryGraph, SHARED_FORMS } from "./shared";

/**
 * New Amend — the WS-A single-order flow for an ERP-INITIATED reschedule
 * (decision B).
 *
 * The difference from New Delivery is the entry context: the ERP fires this (by
 * name, trigger WEBHOOK) when delivery scheduling on our side forces a new date,
 * so the opening proposes the revised date and the same Confirm / Amend handling
 * follows. Everything downstream — confirm-lock, balance, Property Details form,
 * amend sub-flow, ERP callback — is the shared delivery graph (shared.ts).
 *
 * Scope: single order (one ref). The multi-order batch version the owner walked
 * (3 orders per message, looped for N) needs a batch loop the static engine
 * cannot express on its own — that is a separate piece with the ERP driving the
 * batches (one batch = one run). See docs/connect-rebuild-spec.zh.md section 3.
 */

const OPENING = `Hi {full_name} 👋 We're reaching out about your order *{ref_1}*.

Due to our current delivery scheduling, we'd like to arrange a revised delivery date with you.

Proposed Delivery Date: *{delivery_date_1}*
Branding: *{brand_1}*

Please tap *"Confirm Date"* if this works for you. If you'd prefer another date, tap *"Amend Date"* 👇`;

export const newAmendFlow: SeedFlow = {
  key: "new_amend",
  name: "New Amend",
  description:
    "WS-A single-order reschedule flow (ERP-initiated): propose a revised date, confirm or amend, with the shared balance/property/disposal tail, confirm-lock and ERP callback.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "reschedule" },
  forms: SHARED_FORMS,
  build: (formIds) => buildDeliveryGraph({ opening: OPENING, formIds }),
};

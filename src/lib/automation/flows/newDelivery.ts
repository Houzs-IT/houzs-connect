import type { SeedFlow } from "./types";
import { buildDeliveryGraph, SHARED_FORMS } from "./shared";

/**
 * New Delivery — the WS-A single-order delivery-date flow (decision B).
 *
 * ERP fires this (by name, trigger WEBHOOK) when an order is ready for the
 * customer to confirm a fresh delivery date. The conversation itself — confirm
 * or amend, balance nudge, Property Details form, per-company disposal/bank/
 * signature, confirm-lock, ERP callback — is the shared delivery graph; this
 * flow supplies the opening message. See shared.ts for the graph and copy, and
 * docs/connect-rebuild-spec.zh.md for the source.
 */

const OPENING = `Hi {full_name} 👋 Good news! Your order with {company_signature} has been scheduled for delivery.

Sales Order No. : *{ref_1}*
Delivery Date: *{delivery_date_1}*
Branding: *{brand_1}*

We'll confirm the exact delivery time with you again before delivery.

Please tap *"Confirm Date"* if this works for you. If you need to reschedule, please tap *"Amend Date"* 👇`;

export const newDeliveryFlow: SeedFlow = {
  key: "new_delivery",
  // MUST equal the ERP's CONNECT_DELIVERY_AUTOMATION constant (connect.ts) — the
  // ERP fires the delivery follow-up by this exact name, so a mismatch means
  // nothing runs. Keep the two in lockstep if either is renamed.
  name: "New Delivery Follow-up",
  description:
    "WS-A single-order delivery-date flow: confirm or amend, balance nudge, Property Details form, per-company disposal/bank/signature, confirm-lock, ERP callback.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "order_ready" },
  forms: SHARED_FORMS,
  build: (formIds) =>
    buildDeliveryGraph({
      opening: OPENING,
      openerTemplate: "hc_order_delivery_follow_up_1_order",
      openerParams: ["{full_name}", "{ref_1}", "{delivery_date_1}", "{brand_1}"],
      // Multi-order openers, routed on the ERP's order_total. Parameter ORDER
      // is each template's approved positional order (Connect /templates
      // bindings): the 2- and 3-order ones end with order_total, the 4+ one
      // puts it second and prints only the first three orders.
      openers: {
        "2": {
          templateName: "hc_order_delivery_follow_up_2_order",
          params: ["{full_name}", "{ref_1}", "{delivery_date_1}", "{brand_1}", "{ref_2}", "{delivery_date_2}", "{brand_2}", "{order_total}"],
        },
        // TEMPORARY (2026-10-06): the 3-order template was re-submitted to Meta
        // with a stray footer ("sample") and cannot be edited while PENDING. Until
        // it is approved and the footer removed, a 3-order customer gets the
        // 4-order template ("You have a total of 3 orders — here are the first
        // 3"), which prints all three. Restore the "3" entry afterwards:
        // { templateName: "hc_order_delivery_follow_up_3_order", params:
        //   [full_name, ref_1, delivery_date_1, brand_1, ref_2, delivery_date_2,
        //    brand_2, ref_3, delivery_date_3, brand_3, order_total] }.
        "4": {
          templateName: "hc_order_delivery_follow_up_4_order",
          params: ["{full_name}", "{order_total}", "{ref_1}", "{delivery_date_1}", "{brand_1}", "{ref_2}", "{delivery_date_2}", "{brand_2}", "{ref_3}", "{delivery_date_3}", "{brand_3}"],
        },
      },
      formIds,
    }),
};

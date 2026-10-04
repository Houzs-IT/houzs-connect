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

Reference No. : *{ref_1}*
Delivery Date: *{delivery_date_1}*
Branding: *{brand_1}*

We'll confirm the exact delivery time with you again before delivery.

Please tap *"Confirm Date"* if this works for you. If you need to reschedule, please tap *"Amend Date"* 👇`;

export const newDeliveryFlow: SeedFlow = {
  key: "new_delivery",
  name: "New Delivery",
  description:
    "WS-A single-order delivery-date flow: confirm or amend, balance nudge, Property Details form, per-company disposal/bank/signature, confirm-lock, ERP callback.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "order_ready" },
  forms: SHARED_FORMS,
  build: (formIds) => buildDeliveryGraph({ opening: OPENING, formIds }),
};

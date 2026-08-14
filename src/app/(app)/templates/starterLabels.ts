// Labels only — safe to import into a client component. The drafts themselves
// live in actions.ts ("use server"), which a client bundle must never pull in.

export const STARTER_LABELS: { name: string; label: string }[] = [
  { name: "hc_order_delivery_follow_up_1_order", label: "Delivery scheduled (1 order)" },
  { name: "hc_order_amend_follow_up_1_order", label: "Reschedule proposed (1 order)" },
  { name: "delivery_completed_thanks", label: "Delivered — thank you" },
  { name: "after_24_hour_follow_up_message", label: "Re-open an expired conversation" },
  { name: "ask_delivery_address", label: "Ask for the delivery address" },
  { name: "overdue_order_status_update", label: "Order delayed" },
];

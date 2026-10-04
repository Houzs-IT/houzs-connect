import type { SeedFlow } from "./types";
import { LOCKED } from "./shared";

/**
 * Delivery Lock — the confirm-lock guard (decision B, option 乙).
 *
 * After a customer confirms, the delivery flow has written button_status=Confirm
 * and its run has COMPLETED — so a later tap on the old template's "Amend Date"
 * button starts no waiting run; it arrives as a NEW_INCOMING_MESSAGE. This
 * automation catches exactly that (button_status=Confirm AND the last tapped
 * button was "Amend Date") and replies the locked message, instead of the
 * customer tapping and seeing nothing. The date itself can no longer change —
 * the engine never reopens a completed run — so this only adds the reply.
 *
 * `last_button` is written by handleInboundMessage on every button tap. The two
 * routers gate the message, so an ordinary text or a payment slip from a
 * confirmed customer is a no-op. A stale lock across orders is prevented by the
 * ERP sending a fresh button_status on each new-order trigger (go-live
 * checklist). Seeds DRAFT/disabled; enable it alongside the delivery flows.
 */
export const deliveryLockFlow: SeedFlow = {
  key: "delivery_lock",
  name: "Delivery Lock",
  description:
    "After confirmation, a late Amend tap gets the locked message (button_status=Confirm AND last_button=Amend Date); the date cannot be reopened.",
  triggerType: "NEW_INCOMING_MESSAGE",
  triggerConfig: { event: "new_message" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 160 },
      {
        id: "r_confirmed",
        type: "criteria_router",
        x: 240,
        y: 160,
        data: { rules: [{ branch: "yes", field: "button_status", op: "eq", value: "Confirm" }] },
      },
      {
        id: "r_amend",
        type: "criteria_router",
        x: 460,
        y: 100,
        data: { rules: [{ branch: "yes", field: "last_button", op: "eq", value: "Amend Date" }] },
      },
      { id: "locked", type: "send_text", x: 680, y: 60, data: { message: LOCKED } },
      { id: "stop", type: "end", x: 900, y: 160, data: {} },
    ],
    edges: [
      { from: "trigger", to: "r_confirmed" },
      { from: "r_confirmed", to: "r_amend", branch: "yes" },
      { from: "r_confirmed", to: "stop", branch: "default" },
      { from: "r_amend", to: "locked", branch: "yes" },
      { from: "r_amend", to: "stop", branch: "default" },
      { from: "locked", to: "stop" },
    ],
  }),
};

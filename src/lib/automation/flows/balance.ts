import type { SeedFlow } from "./types";
import { BALANCE } from "./shared";

/**
 * Balance Reminder — a standalone outstanding-balance nudge (decision B).
 *
 * Distinct from the balance step inside New Delivery: the ERP fires this (by
 * name, trigger WEBHOOK) to chase an unpaid balance on its own, e.g. days after
 * a delivery was confirmed. Same copy and the same per-company {bank_block} /
 * {balance_due} variables (shared.ts) — no account number in source.
 */
export const balanceReminderFlow: SeedFlow = {
  key: "balance_reminder",
  name: "Balance Reminder",
  description:
    "Standalone outstanding-balance nudge: per-company bank block + amount, tagged for collection.",
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: "balance_due" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 120 },
      { id: "msg", type: "send_text", x: 240, y: 120, data: { message: BALANCE } },
      { id: "tag", type: "add_tag", x: 460, y: 120, data: { tag: "balance collection" } },
      { id: "done", type: "end", x: 680, y: 120, data: {} },
    ],
    edges: [
      { from: "trigger", to: "msg" },
      { from: "msg", to: "tag" },
      { from: "tag", to: "done" },
    ],
  }),
};

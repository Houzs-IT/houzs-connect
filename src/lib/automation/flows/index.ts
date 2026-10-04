import type { SeedFlow } from "./types";
import { newDeliveryFlow } from "./newDelivery";
import { newAmendFlow } from "./newAmend";
import { balanceReminderFlow } from "./balance";
import { repliedCheckFlow } from "./repliedCheck";

export type { SeedFlow, SeedForm } from "./types";
export { validateGraph } from "./validate";

/**
 * The rebuilt WS-A conversation flows, authored in code (decision B). The seed
 * (scripts/seed-flows.ts) upserts each one by (companyId, name) and its forms by
 * (companyId, name), so running it is idempotent and adding a flow is adding a
 * file here. Still to come (need their Seampify copy): Reminders 1/2/3, Driver
 * Info, Postpone, Confirmation, Opt-in/out, and the multi-order batch versions.
 */
export const REBUILD_FLOWS: SeedFlow[] = [
  newDeliveryFlow,
  newAmendFlow,
  balanceReminderFlow,
  repliedCheckFlow,
];

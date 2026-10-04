import type { SeedFlow } from "./types";
import { newDeliveryFlow } from "./newDelivery";
import { newAmendFlow } from "./newAmend";
import { postponeFlow } from "./postpone";
import { deliveryLockFlow } from "./deliveryLock";
import { balanceReminderFlow } from "./balance";
import { repliedCheckFlow } from "./repliedCheck";
import {
  reminder1Flow,
  reminder2Flow,
  reminder3Flow,
  driverInfoFlow,
  deliveryCompletedFlow,
} from "./templateSends";

export type { SeedFlow, SeedForm } from "./types";
export { validateGraph } from "./validate";

/**
 * The rebuilt WS-A conversation flows, authored in code (decision B). The seed
 * (scripts/seed-flows.ts) upserts each one by (companyId, name) and its forms by
 * (companyId, name), so running it is idempotent and adding a flow is adding a
 * file here. Still to come: Postage (needs delivery_address), Opt-in/out
 * (inbound keyword), and the multi-order batch versions.
 */
export const REBUILD_FLOWS: SeedFlow[] = [
  newDeliveryFlow,
  newAmendFlow,
  postponeFlow,
  deliveryLockFlow,
  balanceReminderFlow,
  repliedCheckFlow,
  reminder1Flow,
  reminder2Flow,
  reminder3Flow,
  driverInfoFlow,
  deliveryCompletedFlow,
];

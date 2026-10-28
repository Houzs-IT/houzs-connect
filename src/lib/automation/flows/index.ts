import type { SeedFlow } from "./types";
import { newDeliveryFlow } from "./newDelivery";
import { newAmendFlow } from "./newAmend";
import { postponeFlow } from "./postpone";
import { postageFlow } from "./postage";
import { deliveryLockFlow } from "./deliveryLock";
import { optInOutFlow } from "./optInOut";
import { balanceReminderFlow } from "./balance";
import { repliedCheckFlow } from "./repliedCheck";
import { serviceArrangementFlow } from "./serviceArrangement";
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
 * file here. The single-order + single-message set is complete; the multi-order
 * batch versions (New Delivery / New Amend / Tag) are the remaining big piece.
 */
export const REBUILD_FLOWS: SeedFlow[] = [
  newDeliveryFlow,
  newAmendFlow,
  postponeFlow,
  postageFlow,
  deliveryLockFlow,
  optInOutFlow,
  balanceReminderFlow,
  repliedCheckFlow,
  reminder1Flow,
  reminder2Flow,
  reminder3Flow,
  driverInfoFlow,
  deliveryCompletedFlow,
  serviceArrangementFlow,
];

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
  serviceCaseReceivedFlow,
  overdueOrderFlow,
} from "./templateSends";

import { FLOW_SET_2990, FLOW_SET_THECONTS, type CompanyFlowSet } from "./companies";

export type { SeedFlow, SeedForm } from "./types";
export { validateGraph } from "./validate";
export { graphForCompany, templateGaps, type CompanyFlowSet } from "./companies";

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
  serviceCaseReceivedFlow,
  overdueOrderFlow,
  serviceArrangementFlow,
];

/**
 * Who gets which flows (see companies.ts). Houzs Century: every flow, its own
 * templates. 2990's Home: the delivery flows on its own number, with its
 * `_2990` templates. The Conts: its own guest-messaging set (check-in, checkout,
 * facilities, quiet hours), seeded enabled, on its own number. Hookka gets none.
 * The Conts must NOT receive the Houzs/2990 DELIVERY flows — only its own set.
 */
export const COMPANY_FLOW_SETS: CompanyFlowSet[] = [
  { slug: "houzs-century", flows: REBUILD_FLOWS },
  FLOW_SET_2990,
  FLOW_SET_THECONTS,
];

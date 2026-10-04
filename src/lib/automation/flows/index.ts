import type { SeedFlow } from "./types";
import { newDeliveryFlow } from "./newDelivery";

export type { SeedFlow, SeedForm } from "./types";
export { validateGraph } from "./validate";

/**
 * The rebuilt WS-A conversation flows, authored in code (decision B). The seed
 * (scripts/seed-flows.ts) upserts each one by (companyId, name) and its forms by
 * (companyId, name), so running it is idempotent and adding a flow is adding a
 * file here. More flows (New Amend, Reminders, Driver Info, ...) land as they
 * are built; New Delivery is the pattern.
 */
export const REBUILD_FLOWS: SeedFlow[] = [newDeliveryFlow];

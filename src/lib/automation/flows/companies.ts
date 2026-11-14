import type { FlowGraph } from "../types";
import { BRAND_2990, HOUZS_BRAND } from "@/lib/brand";
import type { SeedFlow } from "./types";
import { newDeliveryFlow } from "./newDelivery";
import { newAmendFlow } from "./newAmend";
import { postponeFlow } from "./postpone";
import { postageFlow } from "./postage";
import { deliveryLockFlow } from "./deliveryLock";
import { optInOutFlow } from "./optInOut";
import { balanceReminderFlow } from "./balance";
import { repliedCheckFlow } from "./repliedCheck";
import {
  reminder1Flow,
  reminder2Flow,
  reminder3Flow,
  driverInfoFlow,
  deliveryCompletedFlow,
  overdueOrderFlow,
} from "./templateSends";
import { THECONTS_FLOWS } from "./theconts";

/**
 * Which company runs which seeded flows, and with which Meta templates.
 *
 * Houzs Century runs every flow with its own templates. 2990's Home runs the
 * DELIVERY flows from its own number (60182058603, its logistics line), under
 * the same automation names, so the ERP keeps firing the same names: the
 * dispatcher (automation/dispatch.ts → resolveErpCompany) sends a 2990 order to
 * 2990's copy once that copy is enabled. The service flows (Service Case
 * Received, Service Arrangement) are NOT in 2990's set — after-sales stays on
 * the one shared service line, 8822, under Houzs Century.
 *
 * A Meta template body is fixed text, so the brand is baked into it: 2990 has
 * its own approved copy of every Houzs-branded template (`<name>_2990`, the same
 * wording and the same {{n}} order with "2990 Home" in place of "Houzs"). The
 * map below swaps them in; a template with no brand in it is shared as-is.
 * `templateGaps` refuses a 2990 graph that would still send a Houzs-branded
 * template, so a new Houzs template can never slip out from 2990's number.
 */

/** Houzs template → 2990's own approved copy (same {{n}} order). */
export const TEMPLATES_2990: Record<string, string> = {
  hc_order_delivery_follow_up_1_order: "hc_order_delivery_follow_up_1_order_2990",
  hc_order_delivery_follow_up_2_order: "hc_order_delivery_follow_up_2_order_2990",
  hc_order_delivery_follow_up_3_order: "hc_order_delivery_follow_up_3_order_2990",
  hc_order_delivery_follow_up_4_order: "hc_order_delivery_follow_up_4_order_2990",
  hc_order_reminder_1: "hc_order_reminder_1_2990",
  hc_order_reminder_2: "hc_order_reminder_2_2990",
  hc_order_reminder_3: "hc_order_reminder_3_2990",
  hc_order_postage_confirm: "hc_order_postage_confirm_2990",
  hc_order_postpone_reason: "hc_order_postpone_reason_2990",
  hc_order_driver_info: "hc_order_driver_info_2990",
  overdue_order_status_update: "overdue_order_status_update_2990",
  hc_order_balance_collection: "hc_order_balance_collection_2990",
};

/** Templates with no company brand in their wording — any company may send them. */
export const BRAND_FREE_TEMPLATES = new Set<string>([
  "hc_order_amend_follow_up_1_order",
  "hc_order_amend_follow_up_2_order",
  "hc_order_amend_follow_up_3_order",
  "hc_order_amend_follow_up_4_order",
  "delivery_completed_thanks",
]);

export interface CompanyFlowSet {
  /** connect.company.slug */
  slug: string;
  flows: SeedFlow[];
  /** Template swaps for this company; omitted = the flows' own templates. */
  templates?: Record<string, string>;
  /** Brand name to put in place of "Houzs Century" in the DEMO/inbox previews. */
  brandName?: string;
  /**
   * Seed NEW automations for this set enabled + PUBLISHED instead of the default
   * DRAFT/disabled. Only affects a FIRST insert; re-seeding never touches an
   * existing automation's enabled/status (seed-flows.ts), so this stays
   * clobber-safe. Used for The Conts, whose fire-on-push flows must be live for
   * the ERP to trigger them by name (a real send is still gated downstream on
   * Meta approval + the shared webhook secret).
   */
  enabled?: boolean;
}

/** 2990's delivery set — the Houzs delivery flows minus after-sales service. */
const DELIVERY_FLOWS_2990: SeedFlow[] = [
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
  overdueOrderFlow,
];

export const FLOW_SET_2990: CompanyFlowSet = {
  slug: "2990",
  flows: DELIVERY_FLOWS_2990,
  templates: TEMPLATES_2990,
  brandName: BRAND_2990.name,
};

/**
 * The Conts' guest-messaging set — its own core-subset templates on its own
 * number (60182941990), fired by name on an ERP push. No `templates` swap (the
 * flows already name The Conts' own templates) and no `brandName` (each body has
 * the property name baked in). Seeded ENABLED so the ERP can trigger it the
 * moment its own push goes live; a real send is still gated on Meta approval of
 * the templates + the shared webhook secret.
 */
export const FLOW_SET_THECONTS: CompanyFlowSet = {
  slug: "the-conts",
  flows: THECONTS_FLOWS,
  enabled: true,
};

/** Swap a graph's send_template names (and preview brand) for a company's own. */
export function graphForCompany(graph: FlowGraph, set: Pick<CompanyFlowSet, "templates" | "brandName">): FlowGraph {
  if (!set.templates && !set.brandName) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.type !== "send_template" || !n.data?.templateName) return n;
      const templateName = set.templates?.[n.data.templateName] ?? n.data.templateName;
      const message =
        set.brandName && typeof n.data.message === "string"
          ? n.data.message.replaceAll(HOUZS_BRAND.name, set.brandName)
          : n.data.message;
      return { ...n, data: { ...n.data, templateName, message } };
    }),
  };
}

/**
 * Templates in a company graph that are neither the company's own copy nor
 * brand-free — i.e. a Houzs-branded template that would go out under another
 * company's name. Empty for Houzs itself (no `templates` map = its own set).
 */
export function templateGaps(graph: FlowGraph, set: Pick<CompanyFlowSet, "templates">): string[] {
  if (!set.templates) return [];
  const own = new Set(Object.values(set.templates));
  const gaps = graph.nodes
    .filter((n) => n.type === "send_template" && n.data?.templateName)
    .map((n) => n.data!.templateName as string)
    .filter((t) => !own.has(t) && !BRAND_FREE_TEMPLATES.has(t));
  return [...new Set(gaps)];
}

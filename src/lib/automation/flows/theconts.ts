import type { SeedFlow } from "./types";
import { buildTemplateSendGraph } from "./shared";
import {
  THECONTS_CORE_TEMPLATES,
  contsFlowParams,
  contsDemoMessage,
} from "@/lib/theconts/coreTemplates";

/**
 * The Conts' guest-messaging send flows — the fire-on-push half of the
 * ERP -> Connect -> Meta chain (theconts-erp-connect-push-spec.md).
 *
 * Each is a one-shot "send one approved template, then stop" WEBHOOK flow, built
 * exactly like templateSends.ts: trigger -> send_template -> end, firing by name
 * on an ERP push. The ERP (Conts-ERP PR #957) posts /api/webhooks/erp with
 * `companySlug: "the-conts"` and `automation: "<this flow's name>"`; the
 * dispatcher (automation/dispatch.ts) matches the enabled WEBHOOK automation of
 * that exact NAME and starts a run, which sends the Meta template.
 *
 * The send_template `params` are the contact-field {key} tokens filling the
 * template's {{1}}..{{n}} IN ORDER — taken from each template's single `vars`
 * mapping in lib/theconts/coreTemplates.ts, so they can never drift from the
 * Meta draft's example order or the saved binding. `message` is the DEMO / inbox
 * preview; the real send uses the named Meta template.
 *
 * These are the exact automation names the ERP's CONNECT_AUTOMATIONS must carry:
 *   - "The Conts Check-in (Skyline KL)"
 *   - "The Conts Check-out (Skyline KL)"
 *   - "The Conts Facilities (Skyline KL)"
 *   - "The Conts Quiet Hours"
 * (Core subset — one building. The full build adds the remaining buildings and
 * message types.)
 */
export const THECONTS_FLOWS: SeedFlow[] = THECONTS_CORE_TEMPLATES.map((t) => ({
  key: t.key,
  name: t.automationName,
  description: t.automationDescription,
  triggerType: "WEBHOOK",
  triggerConfig: { source: "erp", event: t.automationEvent },
  forms: [],
  build: () =>
    buildTemplateSendGraph({
      templateName: t.templateName,
      params: contsFlowParams(t),
      message: contsDemoMessage(t),
    }),
}));

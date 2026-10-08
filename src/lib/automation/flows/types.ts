import type { FlowGraph } from "../types";
import type { FormField } from "@/app/(app)/forms/fields";

/** A WhatsApp Flow form a seeded flow sends. Upserted by (companyId, name). */
export interface SeedForm {
  /** Local handle the flow graph references; resolved to the form row id. */
  key: string;
  /** Form row name (also what the owner sees in /forms). */
  name: string;
  /** `options` on a `select` field become the Flow's dropdown choices; the
   *  chosen option's TEXT is what the submission writes onto the contact.
   *  `required` makes the Flow refuse Submit until the question is answered. */
  fields: (FormField & { options?: string[]; required?: boolean })[];
}

/**
 * A rebuild conversation flow authored in code and upserted into
 * `connect.automation` by (companyId, name). `build` takes the resolved form
 * ids (because send_form nodes reference a form row id that only exists after
 * the form is seeded) and returns the graph.
 */
export interface SeedFlow {
  /** Stable identity for logs / de-duplication; not stored. */
  key: string;
  /** Automation name — also the value the ERP sends as `automation`. */
  name: string;
  description: string;
  /** Column value the dispatcher matches (e.g. "WEBHOOK"). */
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  forms: SeedForm[];
  build(formIds: Record<string, string>): FlowGraph;
}

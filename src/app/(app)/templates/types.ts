// Plain types shared by the Templates server components and their client
// components. Kept out of actions.ts because a "use server" module may export
// only async functions — same reason starterTemplates.ts exists.

import type { VarBinding } from "@/lib/automation/vars";

/** One thing a {{n}} can be pointed at. */
export interface FieldOption {
  /** contact_field.key, or "full_name" / "phone". */
  key: string;
  /** What a human calls it. */
  name: string;
  /** True for full_name / phone — present on every contact, not configurable. */
  builtin?: boolean;
}

/**
 * A real contact used to preview what a template will actually say. Real, not
 * invented: a preview built from made-up values proves nothing about whether
 * the mapping points at fields this company's contacts actually carry.
 */
export interface SampleContact {
  label: string;
  name: string | null;
  phone: string;
  attributes: Record<string, string>;
  /**
   * Contact columns the built-in sources read. OPTIONAL: a caller that only has
   * name/phone/attributes still builds a valid SampleContact, and a built-in
   * nobody supplied previews as blank — which the UI flags — rather than being
   * invented. Keys here mirror BUILT_IN_FIELDS in lib/automation/vars.ts.
   */
  email?: string | null;
  source?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
}

/** A template as the Templates page hands it to a client component. */
export interface TemplateRowData {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  header: string;
  footer: string;
  buttons: string[];
  /** Meta holds a media header this editor cannot round-trip — blocks editing. */
  mediaHeader: boolean;
  /** TEXT, IMAGE, DOCUMENT, VIDEO…; null when the template has no header. */
  headerFormat: string | null;
  /** The file Connect attaches when sending an image / PDF / video header template; the list page fills it. */
  headerFile?: { url: string; fileName: string; format: "IMAGE" | "DOCUMENT" | "VIDEO" } | null;
  rejectedReason?: string | null;
  /** Saved mapping for this exact (name, language). Empty when never mapped. */
  bindings: VarBinding[];
  /** Null when the template can be edited; otherwise why it cannot, in words. */
  editBlocked: string | null;
}

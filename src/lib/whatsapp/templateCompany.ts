// Which company a WhatsApp template belongs to — for the Templates page's
// company filter.
//
// Every company's templates live on the ONE shared WhatsApp Business Account,
// and Meta keeps no owner on a template, so the list mixes Houzs Century, 2990's
// Home and Hookka. A template body is fixed text with the brand baked in (see
// lib/brand.ts), so the brand in its wording — or the `_2990` suffix every 2990
// copy carries — says whose it is. A template that names no company (the amend
// follow-ups, delivery_completed_thanks, storage_charges …) can be sent by any
// company and is "shared".

/** A company code (connect.company.code) or "SHARED" for a brand-free template. */
export type TemplateOwner = "HOUZS" | "2990" | "HOOKKA" | "THECONTS" | "SHARED";

export const SHARED_OWNER = "SHARED" as const;

// First match wins: 2990 before Houzs, since a 2990 template's name keeps the
// `hc_` prefix of the Houzs one it was copied from.
const RULES: { owner: Exclude<TemplateOwner, "SHARED">; test: (name: string, text: string) => boolean }[] = [
  { owner: "2990", test: (name, text) => /_2990$/.test(name) || /\b2990\b/.test(text) },
  { owner: "HOOKKA", test: (name, text) => name.startsWith("hookka") || /hookka/i.test(text) },
  { owner: "THECONTS", test: (name, text) => /conts/i.test(name) || /\bthe conts\b/i.test(text) },
  { owner: "HOUZS", test: (_name, text) => /houzs/i.test(text) },
];

export function templateOwner(t: {
  name: string;
  body?: string | null;
  header?: string | null;
  footer?: string | null;
}): TemplateOwner {
  const name = t.name.toLowerCase();
  const text = [t.header, t.body, t.footer].filter(Boolean).join("\n");
  return RULES.find((r) => r.test(name, text))?.owner ?? SHARED_OWNER;
}

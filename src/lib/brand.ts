// The one place a company's brand words live, for the few spots that must emit
// them as a LITERAL — a Meta template draft (starterTemplates.ts) and the DEMO
// template previews (demo-templates.ts). A Meta-approved template body is fixed
// text with only positional {{n}} slots, so the brand there cannot be a runtime
// variable; it has to be baked in when the draft is built.
//
// Everywhere the copy IS resolved per contact at send time — the conversation
// flows — the brand is NOT a literal and does NOT come from here. Those use the
// ERP-filled {company_signature} variable instead (see
// lib/automation/flows/newDelivery.ts and shared.ts), so a flow serves every
// company without a brand table. Keep that split: reach for this module only
// when you are producing a fixed string a variable cannot cover.
//
// Houzs is the default so every not-yet-wired caller keeps today's wording
// byte-for-byte. 2990 shares Houzs's WhatsApp number for now; its entry is a
// slot kept ready for when it gets its own number (see tasks/OWNER-RUNBOOK §8).

export interface Brand {
  /** Short trading name used inline, e.g. "your {short} order". */
  short: string;
  /** Full brand name, e.g. "the team from {name}". */
  name: string;
  /** Registered entity, for a formal notice, e.g. "your order with {legalName}". */
  legalName: string;
}

export const HOUZS_BRAND: Brand = {
  short: "Houzs",
  name: "Houzs Century",
  legalName: "Houzs Century Sdn Bhd",
};

// TODO(2990 go-live): confirm the exact trading / legal wording with the owner
// before 2990 sends anything under its own number — the spec records it as
// "2990 HOME SDN. BHD." (docs/seampify-spec.md §3).
export const BRAND_2990: Brand = {
  short: "2990 Home",
  name: "2990 Home",
  legalName: "2990 Home Sdn Bhd",
};

/** Used whenever the company is unknown or has no entry — keeps today's copy. */
export const DEFAULT_BRAND = HOUZS_BRAND;

// Keyed by company.slug (the ERP org sync sets these — see lib/companies.ts).
const BY_SLUG: Record<string, Brand> = {
  "houzs-century": HOUZS_BRAND,
  "2990": BRAND_2990,
};

/** The brand for a company slug, or Houzs when the slug is unknown/absent. */
export function brandForSlug(slug: string | null | undefined): Brand {
  return (slug && BY_SLUG[slug]) || DEFAULT_BRAND;
}

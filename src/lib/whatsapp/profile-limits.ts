// The client-safe half of the business profile: categories, limits, the
// validation both the form and the server run. No network code here, so the
// browser bundle can import it (the same split as media-limits.ts).

/**
 * Meta's business categories (the WhatsAppVertical enum, minus UNDEFINED and
 * NOT_A_BIZ which cannot be set). Labels are what a person picks from.
 */
export const VERTICALS: { value: string; label: string }[] = [
  { value: "RETAIL", label: "Shopping & retail" },
  { value: "APPAREL", label: "Clothing & apparel" },
  { value: "AUTO", label: "Automotive" },
  { value: "BEAUTY", label: "Beauty, spa & salon" },
  { value: "EDU", label: "Education" },
  { value: "ENTERTAIN", label: "Entertainment" },
  { value: "EVENT_PLAN", label: "Event planning & service" },
  { value: "FINANCE", label: "Finance & banking" },
  { value: "GROCERY", label: "Food & grocery" },
  { value: "GOVT", label: "Public service" },
  { value: "HOTEL", label: "Hotel & lodging" },
  { value: "HEALTH", label: "Medical & health" },
  { value: "NONPROFIT", label: "Non-profit" },
  { value: "PROF_SERVICES", label: "Professional services" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "TRAVEL", label: "Travel & transportation" },
  { value: "OTHER", label: "Other" },
];

/** Meta's documented limits, checked here so a refusal names the field. */
export const PROFILE_LIMITS = {
  about: 139,
  address: 256,
  description: 512,
  email: 128,
  website: 256,
  websites: 2,
} as const;

export interface BusinessProfile {
  about: string;
  address: string;
  description: string;
  email: string;
  websites: string[];
  vertical: string;
  /** Meta-hosted URL of the current photo; it expires, so never store it. */
  profilePictureUrl: string | null;
}

export type ProfileInput = Omit<BusinessProfile, "profilePictureUrl">;

/** The first thing wrong with a profile, in words, or null when it may be sent. */
export function profileProblem(p: ProfileInput): string | null {
  if (p.about.length > PROFILE_LIMITS.about) {
    return `The about line can be at most ${PROFILE_LIMITS.about} characters (it is ${p.about.length}).`;
  }
  if (p.address.length > PROFILE_LIMITS.address) {
    return `The address can be at most ${PROFILE_LIMITS.address} characters.`;
  }
  if (p.description.length > PROFILE_LIMITS.description) {
    return `The description can be at most ${PROFILE_LIMITS.description} characters (it is ${p.description.length}).`;
  }
  if (p.email && (p.email.length > PROFILE_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))) {
    return "The email address does not look right.";
  }
  if (p.websites.length > PROFILE_LIMITS.websites) {
    return `WhatsApp shows at most ${PROFILE_LIMITS.websites} websites.`;
  }
  for (const w of p.websites) {
    if (w.length > PROFILE_LIMITS.website || !/^https?:\/\/\S+\.\S+/.test(w)) {
      return `"${w}" is not a full web address — it must start with https:// (or http://).`;
    }
  }
  if (p.vertical && !VERTICALS.some((v) => v.value === p.vertical)) {
    return "Pick a business category from the list.";
  }
  return null;
}

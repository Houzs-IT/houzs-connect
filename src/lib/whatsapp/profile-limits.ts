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

/** What the profile photo upload accepts — checked in the browser before sending, and again on the server. */
export const PHOTO_TYPES = ["image/jpeg", "image/png"];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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

/** How each field is named in a sentence ("Saved the about line and address."). */
export const PROFILE_FIELD_LABELS: Record<keyof ProfileInput, string> = {
  about: "about line",
  address: "address",
  description: "description",
  email: "email",
  websites: "websites",
  vertical: "category",
};

/**
 * The first thing wrong with a profile update, in words, or null when it may be
 * sent. Only the fields present are checked, so it takes a whole profile or just
 * the fields that changed.
 */
export function profileProblem(p: Partial<ProfileInput>): string | null {
  if (p.about !== undefined) {
    // Meta's reference: "String cannot be empty. Strings must be between 1 and 139 characters."
    if (p.about.length === 0) {
      return "The about line cannot be left empty on WhatsApp — write one short line.";
    }
    if (p.about.length > PROFILE_LIMITS.about) {
      return `The about line can be at most ${PROFILE_LIMITS.about} characters (it is ${p.about.length}).`;
    }
  }
  if (p.address !== undefined && p.address.length > PROFILE_LIMITS.address) {
    return `The address can be at most ${PROFILE_LIMITS.address} characters.`;
  }
  if (p.description !== undefined && p.description.length > PROFILE_LIMITS.description) {
    return `The description can be at most ${PROFILE_LIMITS.description} characters (it is ${p.description.length}).`;
  }
  if (p.email && (p.email.length > PROFILE_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))) {
    return "The email address does not look right.";
  }
  if (p.websites !== undefined) {
    if (p.websites.length > PROFILE_LIMITS.websites) {
      return `WhatsApp shows at most ${PROFILE_LIMITS.websites} websites.`;
    }
    for (const w of p.websites) {
      if (w.length > PROFILE_LIMITS.website || !/^https?:\/\/\S+\.\S+/.test(w)) {
        return `"${w}" is not a full web address — it must start with https:// (or http://).`;
      }
    }
  }
  if (p.vertical && !VERTICALS.some((v) => v.value === p.vertical)) {
    return "Pick a business category from the list.";
  }
  return null;
}

/** A profile as it would be sent: trimmed, with empty website boxes dropped. */
export function normaliseProfile(p: ProfileInput): ProfileInput {
  // Coerced because the server action is reachable by anything that can POST.
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    about: text(p.about),
    address: text(p.address),
    description: text(p.description),
    email: text(p.email),
    websites: Array.isArray(p.websites) ? p.websites.map(text).filter(Boolean) : [],
    vertical: text(p.vertical),
  };
}

/**
 * Only the fields that differ from what Meta holds now.
 *
 * The form used to send all six fields on every save, so one box left empty
 * could sink the whole save: Meta refuses an empty about line, and an empty
 * string is not an email. A field left the way Meta has it is not sent at all,
 * which lets a profile be filled in one field at a time.
 *
 * The category is only ever sent when one is picked — Meta has no settable
 * "not set", so it cannot be taken back.
 */
export function profileChanges(current: ProfileInput, next: ProfileInput): Partial<ProfileInput> {
  const a = normaliseProfile(current);
  const b = normaliseProfile(next);
  const out: Partial<ProfileInput> = {};
  if (b.about !== a.about) out.about = b.about;
  if (b.address !== a.address) out.address = b.address;
  if (b.description !== a.description) out.description = b.description;
  if (b.email !== a.email) out.email = b.email;
  if (b.websites.join("\n") !== a.websites.join("\n")) out.websites = b.websites;
  if (b.vertical && b.vertical !== a.vertical) out.vertical = b.vertical;
  return out;
}

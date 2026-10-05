export function initials(name?: string | null): string {
  if (!name) return "?";
  // A number stands in for the name: its first two digits ("60"), not "+1".
  if (/^\+?[\d\s-]+$/.test(name.trim())) return name.replace(/\D/g, "").slice(0, 2) || "?";
  const parts = name.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/**
 * Every timestamp in this app is rendered in Malaysian time.
 *
 * These helpers run inside server components, and a Cloudflare Worker's clock
 * is UTC — so toLocaleTimeString() with no timeZone rendered every message
 * EIGHT HOURS EARLY. A message sent at 09:56 appeared as "01:56", which reads
 * as the middle of the night and makes the whole thread untrustworthy.
 */
const TZ = "Asia/Kuala_Lumpur";

export function relTime(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  // Elapsed time is an absolute difference, so it was never affected by the
  // timezone — only the absolute date fallback below was.
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ }).replace("Sept", "Sep");
}

export function clockTime(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

/**
 * The caption of a picture / file message. Its body is the caption plus a
 * placeholder — "[attachment]" from the inbound webhook, "[image] name.jpg" /
 * "[document] name.pdf" for one we sent — and only the caption is real text.
 */
export function mediaCaption(body: string | null | undefined): string {
  return (body ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "[attachment]" && !/^\[(image|document)\] /.test(l.trim()))
    .join("\n")
    .trim();
}

/**
 * One line for a message in a list: its text, or "Photo" / the file name (plus
 * any caption) for a picture or file, never the "[attachment]" placeholder its
 * body carries.
 */
export function previewText(
  m: { body: string | null; type: string; fileName?: string | null },
  labels: { mediaPhoto: string; mediaFile: string }
): string {
  if (m.type === "IMAGE" || m.type === "DOCUMENT") {
    const what = m.type === "IMAGE" ? labels.mediaPhoto : (m.fileName ?? labels.mediaFile);
    const caption = mediaCaption(m.body);
    return caption ? `${what} · ${caption}` : what;
  }
  return m.body ?? "";
}

/** A contact's name, or their number written properly when the "name" is empty or just digits. */
export function displayName(name: string | null | undefined, phone: string): string {
  const n = (name ?? "").trim();
  return n && !/^\+?[\d\s-]+$/.test(n) ? n : formatPhone(phone);
}

/** Inbox list stamp: clock time today, "Yesterday", then dd/mm. */
export function listTime(d?: Date | string | null, yesterday = "Yesterday"): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  const now = new Date();
  if (day(date) === day(now)) return clockTime(date);
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return yesterday;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: TZ });
}

/** "2026/07/31" or "2026-07-31" -> "31/07". Anything else is returned as is. */
export function shortDay(v?: string | null): string {
  if (!v) return "";
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v);
  return m ? `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}` : v;
}

/** How long ago, in the unit people say it: minutes, hours, days, weeks, months. */
export function agoParts(d: Date | string): { unit: "now" | "m" | "h" | "d" | "w" | "mo"; n: number } {
  const date = typeof d === "string" ? new Date(d) : d;
  const min = Math.floor((Date.now() - date.getTime()) / 60000);
  if (min < 1) return { unit: "now", n: 0 };
  if (min < 60) return { unit: "m", n: min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { unit: "h", n: hr };
  const day = Math.floor(hr / 24);
  if (day < 7) return { unit: "d", n: day };
  if (day < 30) return { unit: "w", n: Math.floor(day / 7) };
  return { unit: "mo", n: Math.floor(day / 30) };
}

/** Date + time, for a message older than today. */
export function stamp(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).replace("Sept", "Sep");
}

/** Contact.attributes is stored as JSON (nullable for SQLite). */
export function attrs(a: unknown): Record<string, string> {
  if (!a) return {};
  if (typeof a === "string") {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return a as Record<string, string>;
}

/** Deterministic avatar tint from a string (no Math.random for stability). */
/**
 * How to show whatever WhatsApp gave us as this contact's identifier.
 *
 * `contact.phone` is not always a phone number. Since WhatsApp usernames
 * shipped, a customer can reach us with only a user id like
 * "MY.3816205081852835" and no phone number anywhere in the webhook — the
 * handler stores it verbatim in the same column, because it is the value the
 * Cloud API takes back as `to`.
 *
 * Rendering that as "+MY.3816205081852835" invents a plus sign in front of
 * something that is not a number, under a column headed "Number". Digits get
 * the plus; anything else is shown as-is and labelled for what it is.
 */
export function waIdentifier(raw?: string | null): {
  text: string;
  isPhone: boolean;
  label: string;
} {
  const v = (raw ?? "").trim();
  const isPhone = v.length > 0 && /^\d+$/.test(v);
  return {
    text: isPhone ? formatPhone(v) : v,
    isPhone,
    label: isPhone ? "Phone number" : "WhatsApp username — this contact has no phone number",
  };
}

export function tint(seed: string): string {
  const palette = [
    "#e2900a",
    "#0d7490",
    "#2f8f5b",
    "#8e4ec6",
    "#d5493f",
    "#b45309",
    "#0f766e",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/**
 * A Malaysian WhatsApp number written the way people read it:
 * "601161556133" → "+60 11-6155 6133". Anything else gets a leading "+".
 */
export function formatPhone(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("60")) {
    const r = d.slice(2);
    if (r.length === 9) return `+60 ${r.slice(0, 2)}-${r.slice(2, 5)} ${r.slice(5)}`;
    if (r.length === 10) return `+60 ${r.slice(0, 2)}-${r.slice(2, 6)} ${r.slice(6)}`;
  }
  return d ? `+${d}` : raw;
}

export function initials(name?: string | null): string {
  if (!name) return "?";
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
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
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
  });
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

/**
 * Pure dashboard helpers. Kept out of `ui.tsx` on purpose: that module is
 * `"use client"`, and everything exported from a client module becomes a client
 * reference — the streamed server sections could not call these from there.
 */

export function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return (part / whole) * 100;
}

export function maxReach(tags: { reach: number }[]): number {
  return Math.max(1, ...tags.map((t) => t.reach));
}

/**
 * The business is in Malaysia; the Worker's clock is UTC. Every bucket boundary
 * and every day label below is therefore pinned to Kuala Lumpur — a UTC day
 * ended at 8am local, so "today" on the chart used to start the previous
 * afternoon and messages landed in the wrong column.
 */
const TZ = "Asia/Kuala_Lumpur";

/** `YYYY-MM-DD` for the Malaysian calendar day an instant falls on. */
const KL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function klDayKey(d: Date): string {
  // formatToParts rather than the formatted string: the assembled key must be
  // YYYY-MM-DD regardless of how the runtime's locale data orders the fields.
  const parts = KL_PARTS.formatToParts(d);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

export interface DayBucket {
  /** `YYYY-MM-DD` in Malaysian time — matches the SQL `date_trunc` key. */
  key: string;
  label: string;
}

/**
 * The seven-day reporting window, anchored to Malaysian calendar days.
 *
 * Reading the clock is impure, so this is called once at the top of a section
 * rather than inside a render. Malaysia is UTC+8 all year (no daylight saving),
 * so a day is exactly 86,400,000 ms and midnight local is a fixed +08:00 offset.
 */
export function reportWindow(): { since: Date; days: DayBucket[] } {
  const todayStart = new Date(`${klDayKey(new Date())}T00:00:00+08:00`);
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * 86_400_000);
    days.push({
      key: klDayKey(d),
      label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: TZ }),
    });
  }
  return { since: new Date(todayStart.getTime() - 6 * 86_400_000), days };
}

/** Plain-language elapsed time — "8s", "4m 12s", "2h 5m". */
export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

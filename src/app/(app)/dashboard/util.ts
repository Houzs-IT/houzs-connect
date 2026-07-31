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

export interface DayBucket {
  /** `YYYY-MM-DD` in UTC — matches the SQL `date_trunc('day', … at time zone 'UTC')` key. */
  key: string;
  label: string;
}

/**
 * The seven-day reporting window, anchored to UTC.
 *
 * Reading the clock is impure, so this is called once at the top of a section
 * rather than inside a render. UTC (not server-local) keeps the JS buckets and
 * the SQL `date_trunc` buckets on the same grid regardless of where the Worker
 * happens to run.
 */
export function reportWindow(): { since: Date; days: DayBucket[] } {
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const days: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayUtc - i * 86_400_000);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    });
  }
  return { since: new Date(todayUtc - 6 * 86_400_000), days };
}

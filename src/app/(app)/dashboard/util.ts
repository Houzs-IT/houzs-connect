/**
 * Pure dashboard helpers. Kept out of `ui.tsx` on purpose: that module is
 * `"use client"`, and everything exported from a client module becomes a client
 * reference — the streamed server sections could not call these from there.
 */

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

/** Periods the dashboard offers, in days. */
export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];

export function parsePeriod(v: string | undefined): PeriodDays {
  const n = Number(v);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : 30;
}

export interface PeriodWindow {
  days: PeriodDays;
  /** Start of the first Malaysian day in the period. */
  since: Date;
  /** Start of the equally long period before it — for "vs prev period". */
  prevSince: Date;
  /** One bucket per Malaysian day, oldest first; label `dd/MM`. */
  buckets: DayBucket[];
  /** e.g. "3 Sep – 2 Oct 2026". */
  rangeLabel: string;
}

/**
 * An N-day reporting window ending today, anchored to Malaysian calendar days
 * like `reportWindow`. Reads the clock — call once per request, not in render.
 */
export function periodWindow(days: PeriodDays, locale = "en-GB"): PeriodWindow {
  const todayStart = new Date(`${klDayKey(new Date())}T00:00:00+08:00`);
  const since = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  const prevSince = new Date(since.getTime() - days * 86_400_000);
  const buckets: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000);
    buckets.push({
      key: klDayKey(d),
      label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: TZ }),
    });
  }
  // Hand-built so English reads "4 Sep" (en-GB's "Sept" does not match the
  // design) and Chinese reads "9月4日".
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date, withYear: boolean) => {
    const [y, m, day] = klDayKey(d).split("-").map(Number);
    return locale.startsWith("zh")
      ? `${withYear ? `${y}年` : ""}${m}月${day}日`
      : `${day} ${MON[m - 1]}${withYear ? ` ${y}` : ""}`;
  };
  return { days, since, prevSince, buckets, rangeLabel: `${fmt(since, false)} – ${fmt(todayStart, true)}` };
}

/** Signed change for "vs prev period" chips; null when there is no baseline. */
export function delta(now: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((now - prev) / prev) * 100;
}

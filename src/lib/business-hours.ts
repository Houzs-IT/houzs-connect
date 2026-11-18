// Business-hours-aware elapsed time for the CS dashboard reply/resolution metrics.
//
// Reuses the per-company working hours the auto-reply feature already stores
// (connect.auto_reply.hours = WeekHours, .timezone) as the SINGLE source of truth
// — no new config, no migration. When a company has set hours, the dashboard's
// first-reply / avg-reply / resolution-time count only the minutes that fall
// inside those hours (so a message at 11pm answered at 9am counts the morning
// minutes, not the whole overnight gap). When no hours are configured, every
// caller falls back to plain wall-clock, i.e. today's behaviour.
//
// Timezone is honoured via Intl; Kuala_Lumpur (the default) has no DST so the
// offset is constant and the arithmetic is exact. For a DST timezone the result
// is exact except within the hour of a transition, which is acceptable here.

import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { autoReply } from "@/db/schema";
import { ensureAutoReplyTable } from "@/db/ensure-auto-reply";
import { bypassReadCache } from "@/db/fresh";
import { DAYS, parseClock, type Day, type WeekHours } from "@/lib/auto-reply/decide";

const DEFAULT_TZ = "Asia/Kuala_Lumpur";
const DAY_MS = 86_400_000;

export interface BizHours {
  /** Per-company open hours; null / no usable slot => callers use wall-clock. */
  hours: WeekHours | null;
  tz: string;
}

/**
 * The company's configured business hours, read from the auto-reply settings
 * (one source of truth). No row / no hours => wall-clock fallback. Never throws.
 */
export async function loadBusinessHours(db: DB, companyId: string): Promise<BizHours> {
  try {
    await ensureAutoReplyTable(db);
    const row = await db.query.autoReply.findFirst({
      where: and(eq(autoReply.companyId, companyId), bypassReadCache()),
      columns: { hours: true, timezone: true },
    });
    return { hours: (row?.hours as WeekHours | null) ?? null, tz: row?.timezone || DEFAULT_TZ };
  } catch {
    return { hours: null, tz: DEFAULT_TZ };
  }
}

/** True when at least one weekday has a usable open/close slot. */
export function hasBusinessHours(cfg: BizHours): boolean {
  const h = cfg.hours;
  if (!h) return false;
  return DAYS.some((d) => {
    const s = h[d];
    return !!s && parseClock(s.open) !== null && parseClock(s.close) !== null;
  });
}

const SHORT_TO_DAY: Record<string, Day> = {
  Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun",
};

/** Offset (ms) by which local wall-clock in `tz` leads UTC at instant `ms`. */
function tzOffsetMs(ms: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUTC - ms;
}

/** Absolute ms for a local wall time (minutes past midnight) on a local Y-M-D in `tz`. */
function localToMs(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  return guess - tzOffsetMs(guess, tz);
}

/** Local Y-M-D + weekday at instant `ms` in `tz`. */
function localDate(ms: number, tz: string): { y: number; m: number; d: number; day: Day } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), day: SHORT_TO_DAY[g("weekday")] ?? "mon" };
}

/**
 * Seconds of OPEN time between `fromMs` and `toMs`, summing each local day's
 * slot intersected with [from,to]. A slot whose close is at/before its open runs
 * past midnight into the next local day (same reading as auto-reply's isOpen).
 */
export function businessElapsedSeconds(fromMs: number, toMs: number, hours: WeekHours, tz: string): number {
  if (toMs <= fromMs) return 0;
  const start = localDate(fromMs, tz);
  // Begin a day early so a previous-day past-midnight slot that spills into
  // `from`'s day is counted. Iterate forward one local day at a time.
  let cursor = localToMs(start.y, start.m, start.d, 0, tz) - DAY_MS;
  let total = 0;
  for (let i = 0; i < 400 && cursor <= toMs; i++, cursor += DAY_MS) {
    const { y, m, d, day } = localDate(cursor + DAY_MS / 2, tz); // noon: clear of midnight edges
    const slot = hours[day];
    if (!slot) continue;
    const open = parseClock(slot.open);
    const close = parseClock(slot.close);
    if (open === null || close === null) continue;
    const s = localToMs(y, m, d, open, tz);
    let e: number;
    if (open < close) {
      e = localToMs(y, m, d, close, tz);
    } else {
      // Past midnight: closes on the next local day.
      const nx = localDate(localToMs(y, m, d, 0, tz) + DAY_MS + DAY_MS / 2, tz);
      e = localToMs(nx.y, nx.m, nx.d, close, tz);
    }
    const lo = Math.max(s, fromMs);
    const hi = Math.min(e, toMs);
    if (hi > lo) total += hi - lo;
  }
  return total / 1000;
}

/**
 * The dashboard's single clock: business-open seconds when the company has hours
 * configured, else plain wall-clock seconds. Used by first-reply, avg-reply and
 * resolution-time so all three read on one clock.
 */
export function elapsedSeconds(fromMs: number, toMs: number, cfg: BizHours): number {
  if (toMs <= fromMs) return 0;
  if (hasBusinessHours(cfg)) return businessElapsedSeconds(fromMs, toMs, cfg.hours!, cfg.tz);
  return (toMs - fromMs) / 1000;
}

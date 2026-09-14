// When to send an automatic reply — pure, so scripts/smoke-auto-reply.mjs can pin
// it without a database or a clock.
//
// Two replies, and at most one per customer message:
//   - AWAY, outside business hours. Sent once, then not repeated in the same
//     conversation for `awayRepeatHours`: a customer who writes five messages at
//     midnight hears it once.
//   - WELCOME, inside business hours, to a customer writing in fresh — their
//     first message in the conversation, or the first after `welcomeAfterHours`
//     of silence. Not repeated inside that same window.
// Outside hours the away message wins and no welcome follows it: two automatic
// messages in a row read like a machine talking over itself.

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface Slot {
  open: string; // "HH:MM"
  close: string; // "HH:MM"; earlier than open means it runs past midnight
}
export type WeekHours = Partial<Record<Day, Slot | null>>;

export interface AutoReplySettings {
  welcomeEnabled: boolean;
  welcomeText: string;
  welcomeAfterHours: number;
  awayEnabled: boolean;
  awayText: string;
  hours: WeekHours | null;
  timezone: string;
  awayRepeatHours: number;
}

const HOUR = 3600_000;
const SHORT_TO_DAY: Record<string, Day> = {
  Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun",
};

export function parseClock(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Weekday and minutes past midnight at `now`, in `timeZone`. */
export function localClock(now: Date, timeZone: string): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: SHORT_TO_DAY[get("weekday")] ?? "mon",
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/**
 * Whether the business is open at `now`. A day with no slot is closed. A slot
 * whose close is before its open runs past midnight — the part after midnight
 * belongs to the day it STARTED on, which is how a shop reads its own hours.
 */
export function isOpen(now: Date, hours: WeekHours, timeZone: string): boolean {
  const { day, minutes } = localClock(now, timeZone);
  const today = hours[day];
  if (today) {
    const open = parseClock(today.open);
    const close = parseClock(today.close);
    if (open !== null && close !== null) {
      if (open < close && minutes >= open && minutes < close) return true;
      if (close <= open && minutes >= open) return true;
    }
  }
  const yesterday = hours[DAYS[(DAYS.indexOf(day) + 6) % 7]];
  if (yesterday) {
    const open = parseClock(yesterday.open);
    const close = parseClock(yesterday.close);
    if (open !== null && close !== null && close <= open && minutes < close) return true;
  }
  return false;
}

export interface DecideInput {
  settings: AutoReplySettings;
  now: Date;
  /** The customer's previous message in this conversation, before the one that just arrived. */
  previousInboundAt: Date | null;
  lastWelcomeAt: Date | null;
  lastAwayAt: Date | null;
}

export function decideAutoReply(i: DecideInput): "away" | "welcome" | null {
  const s = i.settings;
  const since = (d: Date | null) => (d ? i.now.getTime() - d.getTime() : Infinity);

  const awayReady = s.awayEnabled && s.awayText.trim() !== "" && s.hours !== null;
  if (awayReady && !isOpen(i.now, s.hours!, s.timezone)) {
    return since(i.lastAwayAt) >= s.awayRepeatHours * HOUR ? "away" : null;
  }

  if (s.welcomeEnabled && s.welcomeText.trim() !== "") {
    const window = s.welcomeAfterHours * HOUR;
    if (since(i.previousInboundAt) >= window && since(i.lastWelcomeAt) >= window) return "welcome";
  }
  return null;
}

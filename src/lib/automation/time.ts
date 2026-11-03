// Pure time helpers for the scheduler (Delay node + Drip steps). Dependency-free
// so scripts/smoke-delay.mjs can pin them without a DB.

const UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * Milliseconds for a Delay / Drip step's {unit, amount}. An unknown unit is
 * treated as minutes; a missing, non-numeric or negative amount is 0, so a
 * mis-built delay resumes on the next tick rather than hanging forever.
 */
export function delayMs(unit: string | undefined, amount: number | undefined): number {
  const per = UNIT_MS[unit ?? "minutes"] ?? UNIT_MS.minutes;
  const n = typeof amount === "number" && amount > 0 ? amount : 0;
  return per * n;
}

/** The instant a delay/step that starts at `from` becomes due. */
export function dueAt(
  unit: string | undefined,
  amount: number | undefined,
  from: Date = new Date()
): Date {
  return new Date(from.getTime() + delayMs(unit, amount));
}

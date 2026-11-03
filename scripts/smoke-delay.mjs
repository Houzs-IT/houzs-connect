// Pure smoke for the scheduler's delay timing (no DB, no network).
//
// Pins src/lib/automation/time.ts — the unit→ms conversion a Delay node and a
// Drip step both use to compute when they are due. A regression here would make
// every timed step fire at the wrong time (or, for a zero/garbage amount, never).
//
// Runs under tsx (same hooks as smoke-channel-routing.mjs) so it imports the real .ts.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { delayMs, dueAt } = await import("../src/lib/automation/time.ts");

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

assert(delayMs("minutes", 5) === 5 * MIN, "5 minutes");
assert(delayMs("hours", 2) === 2 * HOUR, "2 hours");
assert(delayMs("days", 3) === 3 * DAY, "3 days");

// Unknown unit falls back to minutes, not zero (a stalled run is worse than an
// early one).
assert(delayMs("weeks", 1) === 1 * MIN, "unknown unit → minutes");
assert(delayMs(undefined, 4) === 4 * MIN, "missing unit → minutes");

// A missing / zero / negative / non-numeric amount is 0 ms, so the run resumes on
// the next tick rather than hanging forever (the whole bug this scheduler fixes).
assert(delayMs("days", undefined) === 0, "missing amount → 0");
assert(delayMs("days", 0) === 0, "zero amount → 0");
assert(delayMs("days", -2) === 0, "negative amount → 0");
assert(delayMs("days", Number.NaN) === 0, "NaN amount → 0");

// dueAt adds the delay to the given instant.
const base = new Date("2026-01-01T00:00:00.000Z");
assert(dueAt("hours", 1, base).getTime() === base.getTime() + HOUR, "dueAt adds the delay");
assert(dueAt("minutes", 0, base).getTime() === base.getTime(), "a zero delay is due immediately");

console.log("smoke-delay: all assertions passed");

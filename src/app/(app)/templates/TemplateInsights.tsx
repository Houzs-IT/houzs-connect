// Delivered / read counts in the template list — Seampify's "Message delivered"
// and "Message read rate" columns, and the thing they do that a number alone
// cannot: say when there is no number to show.
//
// The whole point of this file is the difference between two sentences:
//
//   "This template delivered 0 messages."      ← a fact about the template
//   "Meta will not tell us what this delivered." ← a fact about our access
//
// Rendered identically they are indistinguishable, and reading the second as
// the first is how a broken send path stays invisible. So a refused read never
// renders as a zero: the row says the counts are unavailable and the banner
// says why, in Meta's own words.
//
// Server components — plain markup, no state, handed to the client TemplateRow
// through its children slot.

import type { AnalyticsRefusal, TemplateStats } from "@/lib/whatsapp/templates";
import { readRate } from "@/lib/whatsapp/templates";

/** 1234 → "1,234". Counts read wrong without a separator once they pass 999. */
function num(n: number): string {
  return n.toLocaleString("en-GB");
}

/** Seampify shows two decimals ("65.10%"); matching it keeps the two readable side by side. */
function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * The one-line readout that sits with each template's actions.
 *
 * `stats` is undefined when this template was never asked about (the list was
 * filtered, or analytics never ran) — which is not the same as a refusal and is
 * not the same as zero, so it renders nothing at all.
 */
export function DeliveryStat({ stats, days }: { stats?: TemplateStats; days: number }) {
  if (!stats) return null;

  if (!stats.ok) {
    return (
      <span
        title={`Meta's answer: ${stats.error}`}
        className="inline-flex cursor-help items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-warning)]"
      >
        Delivery counts unavailable
      </span>
    );
  }

  const { sent, delivered, read } = stats.counts;

  if (sent === 0 && delivered === 0) {
    return (
      <span
        title={`Meta counted no sends of this template in the last ${days} days. This is a real zero — the analytics call answered for it.`}
        className="inline-flex cursor-help items-center rounded-md px-2 py-1 text-[11px] text-[var(--color-faint)]"
      >
        No sends in {days} days
      </span>
    );
  }

  const rate = readRate(stats.counts);

  return (
    <span
      title={
        `Last ${days} days · sent ${num(sent)} · delivered ${num(delivered)} · read ${num(read)}. ` +
        "Read rate is read ÷ delivered, the same as Meta's own."
      }
      className="inline-flex cursor-help items-baseline gap-1.5 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-[var(--color-muted)]"
    >
      <span className="font-medium text-[var(--color-ink)]">{num(delivered)}</span>
      delivered
      <span className="text-[var(--color-faint)]">·</span>
      {rate === null ? (
        <span title="Nothing was delivered, so there is no rate to take a percentage of.">
          no read rate
        </span>
      ) : (
        <>
          <span className="font-medium text-[var(--color-ink)]">{pct(rate)}</span>
          read ({num(read)})
        </>
      )}
    </span>
  );
}

/**
 * Why the whole list has no counts. Shown once, above the list, whenever the
 * analytics read failed or came back empty for everything.
 *
 * It carries Meta's raw sentence as well as the explanation: the plain-language
 * part is a reading of the error, and a reading can be wrong, so the thing Meta
 * actually said stays on screen next to it.
 */
export function AnalyticsRefusalBanner({
  refusal,
  days,
}: {
  refusal: AnalyticsRefusal;
  days: number;
}) {
  return (
    <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-4">
      <h3 className="text-[13px] font-semibold text-[var(--color-warning)]">
        Delivered and read counts are unavailable — they are not zero
      </h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink)]">{refusal.message}</p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        Asked Meta for <span className="font-mono">SENT</span>,{" "}
        <span className="font-mono">DELIVERED</span> and <span className="font-mono">READ</span> over
        the last {days} days. Meta answered:{" "}
        <span className="font-mono text-[var(--color-ink)]">{refusal.detail}</span>
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        Everything else on this page is unaffected — the template list, status and editing all come
        from a different call that worked.
      </p>
    </div>
  );
}

/** Counts came back, but Meta had more pages than were read. A floor, not a total. */
export function AnalyticsIncompleteNote({ note }: { note: string }) {
  return (
    <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
      {note}
    </div>
  );
}

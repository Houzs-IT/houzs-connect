/**
 * Durable record of every delivery/service date proposed in a conversation.
 *
 * The ERP arranges an initial date (`delivery_date_1`) and the customer can
 * submit preferred dates through the "New Delivery Date" / service form, which
 * overwrites `amended_delivery_date` each time — so without this the per-proposal
 * history survives only on the chat messages (and only for as long as they are
 * loaded). This keeps the full history as one contact attribute, newest last,
 * so the inbox panel, the Contacts page and exports can all read it as a record.
 */

/** Contact-attribute key holding the history: [{ date, source, at }], oldest first. */
export const DELIVERY_DATE_HISTORY_KEY = "delivery_date_history";

/** Attribute keys whose non-empty writes count as a customer-proposed date. */
export const CUSTOMER_DATE_KEYS = new Set(["amended_delivery_date"]);

/** The ERP automation name for an ERP-initiated postponement (postpone.ts). */
export const POSTPONE_AUTOMATION = "Postpone";

/**
 * ERP automations whose webhook actually PROPOSES a date to the customer — the
 * openers that send a "Confirm Date / Amend Date" message. Only these count as
 * an ERP proposal. Every other ERP event (reminders, driver info, the periodic
 * `__erp_contact_sync__`) merely carries the current date along and must not be
 * recorded, or the history fills with dates the customer was never asked about.
 * Names must match the ERP's automation names (connect.automation.name).
 *
 * The confirm/amend openers carry the proposed date in `delivery_date_1`;
 * Postpone carries its NEW date in `new_delivery_date` instead (applyErpDateEffects
 * picks the right key). Postpone is included so its new date is recorded too — and
 * because the history is the only reliable record of the date the customer was last
 * told, Postpone also reads it back for the "original date" it shows.
 */
export const DATE_PROPOSAL_AUTOMATIONS = new Set([
  "New Delivery Follow-up",
  "New Amend",
  "Service Arrangement",
  POSTPONE_AUTOMATION,
]);

/** The last entry already records this date+source — avoids consecutive repeats. */
export function lastEntryMatches(
  history: DeliveryDateEntry[],
  date: string,
  source: DeliveryDateEntry["source"]
): boolean {
  const last = history[history.length - 1];
  return !!last && last.date === date && last.source === source;
}

export interface DeliveryDateEntry {
  /** The date as the customer/ERP gave it (format unchanged: e.g. "2026-11-18"). */
  date: string;
  source: "erp" | "customer";
  /** ISO timestamp of when it was recorded. */
  at: string;
}

/**
 * Read the stored history off a contact's `attributes` value. Accepts the raw
 * jsonb (already an array) or a JSON string, and tolerates anything malformed by
 * returning an empty list — this must never throw on a render path.
 */
export function parseDeliveryDateHistory(raw: unknown): DeliveryDateEntry[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (e): e is DeliveryDateEntry =>
      !!e && typeof (e as { date?: unknown }).date === "string" && (e as { date: string }).date.trim() !== ""
  );
}

/** Append one entry, returning a new array (the input is not mutated). */
export function appendDeliveryDate(
  history: DeliveryDateEntry[],
  date: string,
  source: DeliveryDateEntry["source"]
): DeliveryDateEntry[] {
  return [...history, { date, source, at: new Date().toISOString() }];
}

/**
 * The last date the ERP scheduled and announced to the customer (source "erp").
 * Postpone shows this as its "original" date — the date WE committed to — rather
 * than a customer's un-accepted amend REQUEST (which also lands in the history, as
 * source "customer") or the ERP's injected value (already overwritten with the new
 * date by Send Now time). Undefined when the history holds no ERP date yet.
 */
export function lastScheduledDate(history: DeliveryDateEntry[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].source === "erp") return history[i].date;
  }
  return undefined;
}

/**
 * The delivery-date side effects of one ERP webhook, computed from the contact's
 * current history. Pure (no DB, no clock beyond appendDeliveryDate's stamp) so the
 * rule can be reasoned about and tested on its own; dispatch.ts merges the result
 * onto the contact.
 *
 *  - `clientDeliveryDate` — set ONLY for Postpone: the original date to show, taken
 *    from the history's last ERP-scheduled entry rather than the ERP's injected
 *    (unreliable) `client_delivery_date`. Absent when the history holds no ERP date
 *    (dispatch then keeps whatever the ERP sent, the old behaviour).
 *  - `history` — the new history after recording this webhook's proposed date, or
 *    absent when nothing is recorded (not a proposal opener, no date, or a repeat
 *    of the last entry). The confirm/amend openers propose in `delivery_date_1`;
 *    Postpone proposes its new date in `new_delivery_date`.
 */
export function applyErpDateEffects(args: {
  automation: string;
  attributes: Record<string, string> | undefined;
  history: DeliveryDateEntry[];
}): { clientDeliveryDate?: string; history?: DeliveryDateEntry[] } {
  const { automation, attributes, history } = args;
  const out: { clientDeliveryDate?: string; history?: DeliveryDateEntry[] } = {};

  if (automation === POSTPONE_AUTOMATION) {
    const original = lastScheduledDate(history);
    if (original) out.clientDeliveryDate = original;
  }

  const proposed = (
    automation === POSTPONE_AUTOMATION ? attributes?.new_delivery_date : attributes?.delivery_date_1
  )?.trim();
  if (proposed && DATE_PROPOSAL_AUTOMATIONS.has(automation) && !lastEntryMatches(history, proposed, "erp")) {
    out.history = appendDeliveryDate(history, proposed, "erp");
  }

  return out;
}

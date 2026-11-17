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

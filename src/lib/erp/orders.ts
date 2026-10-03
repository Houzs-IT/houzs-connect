import { getCloudflareContext } from "@opennextjs/cloudflare";

/*
  Houzs ERP sales orders, for the Service panel's Order tab.

  Connect knows an order only by the customer's reference (contact attribute
  `ref_1`, e.g. "znt5961"); the ERP answers that with every matching order via
  GET /api/scm/mfg-sales-orders/by-ref/:ref (ERP routes/mfg-so-by-ref.ts),
  authenticated with the same service token the org sync uses. Money comes back
  in sen and is computed by the ERP's own balance rule, so the two systems can
  never disagree on what a customer owes.

  Reads are cached per isolate for a minute — the panel re-renders every few
  seconds while a thread is open, and the ERP route is not free.
*/

const DEFAULT_ERP_BASE = "https://erp.houzscentury.com";
/** Where an agent opens an order in the ERP. */
export const ERP_WEB_BASE = "https://erp.houzscentury.com";
const CACHE_MS = 60_000;
const TIMEOUT_MS = 4_000;

export type ErpOrder = {
  docNo: string;
  status: string | null;
  onHold: boolean;
  soDate: string | null;
  debtorName: string | null;
  ref: string | null;
  customerSoNo: string | null;
  totalSen: number;
  paidSen: number;
  /** Signed: negative = over-collected. */
  balanceSen: number;
};

export type ErpLookup =
  | { ok: true; orders: ErpOrder[] }
  | { ok: false; reason: "not_configured" | "unreachable" | "refused" };

const cache = new Map<string, { at: number; value: ErpLookup }>();

export function erpConfig(): { base: string; token: string } | null {
  const { env } = getCloudflareContext();
  const token = (env as { ERP_SERVICE_TOKEN?: string }).ERP_SERVICE_TOKEN;
  if (!token) return null;
  return { base: (env as { ERP_API_BASE?: string }).ERP_API_BASE || DEFAULT_ERP_BASE, token };
}

export function erpHeaders(token: string, erpCompanyId: number | null): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    // Which company's books: the Connect company's ERP id. Without it the ERP
    // falls back to its hostname default (Houzs).
    ...(erpCompanyId != null ? { "x-company-id": String(erpCompanyId) } : {}),
  };
}

export async function ordersByRef(ref: string, erpCompanyId: number | null): Promise<ErpLookup> {
  const cfg = erpConfig();
  if (!cfg) return { ok: false, reason: "not_configured" };
  const key = `${erpCompanyId ?? ""}:${ref.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: ErpLookup;
  try {
    const res = await fetch(`${cfg.base}/api/scm/mfg-sales-orders/by-ref/${encodeURIComponent(ref)}`, {
      headers: erpHeaders(cfg.token, erpCompanyId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      value = { ok: false, reason: res.status >= 500 ? "unreachable" : "refused" };
    } else {
      const body = (await res.json()) as { orders?: ErpOrder[] };
      value = { ok: true, orders: Array.isArray(body.orders) ? body.orders : [] };
    }
  } catch {
    value = { ok: false, reason: "unreachable" };
  }
  // Failures are cached too, but briefly, so a down ERP is not hammered and a
  // recovered one shows up within seconds.
  cache.set(key, { at: value.ok ? Date.now() : Date.now() - CACHE_MS + 10_000, value });
  return value;
}

/** Drop cached lookups for a ref — after a payment is recorded against it. */
export function forgetRef(ref: string, erpCompanyId: number | null) {
  cache.delete(`${erpCompanyId ?? ""}:${ref.toLowerCase()}`);
}

export type PickOption = { value: string; label: string };

type Picklists = { onlineTypes: PickOption[]; merchants: PickOption[] };
const pickCache = new Map<string, { at: number; value: Picklists }>();
const PICK_CACHE_MS = 10 * 60_000;

/** The ERP's payment picklists: online sub-types and merchant banks. Cached
 *  for ten minutes — they change when Finance edits SO Maintenance. */
export async function paymentPicklists(erpCompanyId: number | null): Promise<Picklists | null> {
  const cfg = erpConfig();
  if (!cfg) return null;
  const hit = pickCache.get(String(erpCompanyId ?? ""));
  if (hit && Date.now() - hit.at < PICK_CACHE_MS) return hit.value;
  const one = async (category: string): Promise<PickOption[]> => {
    const res = await fetch(`${cfg.base}/api/scm/so-dropdown-options?category=${category}`, {
      headers: erpHeaders(cfg.token, erpCompanyId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { options?: { value: string; label?: string; active?: boolean }[] } | { value: string; label?: string; active?: boolean }[];
    const rows = Array.isArray(body) ? body : (body.options ?? []);
    return rows.filter((r) => r.active !== false).map((r) => ({ value: r.value, label: r.label || r.value }));
  };
  try {
    const [onlineTypes, merchants] = await Promise.all([one("online_type"), one("payment_merchant")]);
    const value = { onlineTypes, merchants };
    pickCache.set(String(erpCompanyId ?? ""), { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

/** Today and 14 days back, Malaysian calendar — the ERP's slip-date window. */
export function slipWindow(): { today: string; oldest: string } {
  const TZ = "Asia/Kuala_Lumpur";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const oldest = new Date(new Date(`${today}T00:00:00+08:00`).getTime() - 14 * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: TZ }
  );
  return { today, oldest };
}

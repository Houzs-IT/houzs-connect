// HOUZS CONNECT -> ERP payment push.
//
// When an admin confirms a customer's payment in the Payments module (status ->
// VERIFIED), Connect POSTs it to the ERP so it lands on the matching Sales Order
// automatically. Before this, a confirmed payment stayed in Connect's own DB and
// someone keyed it into the ERP by hand.
//
// CONTRACT: POST {ERP base}/api/connect/payments, Bearer <ERP_SERVICE_TOKEN>.
// The ERP knows that same shared token as CONNECT_SERVICE_TOKEN. connect_payment_id
// is the ERP's idempotency key — the SAME id goes on every retry, so a payment is
// recorded in the ERP at most once. The ERP's own PR (Houzs-Century/Houzs-ERP#5212)
// builds the receiving endpoint; until it is merged a push 404s and stays PENDING,
// then succeeds on the next retry once the endpoint is live.
//
// TRANSPORT: the ERP's /api/* is answered "400, empty body" by the edge for a
// plain same-zone POST from this Worker (see wrangler.toml lines 20-31 and
// lib/automation/rest.ts) — so, exactly like the automation engine's call_rest_api,
// the push goes over the `env.ERP` Service Binding (autocount-sync-api) when it is
// present, and falls back to rawFetch + the base URL off the Worker (local dev,
// scripts, staging). rawFetch is the runtime's own fetch, never Next's patched one.
//
// FIELDS: the ERP wants method (Card/Online/Cash), the slip's printed date, the
// acquirer bank, the online sub-type, the tenure and the approval code. Connect
// reads all of these off the slip at intake (lib/receipt-vision.ts, whose rules
// mirror the ERP's own scan-payment) but only persists a conflated `method` and a
// prose note — so the push RE-READS the slip image (whose bytes it must download
// for slip_base64 anyway) to recover those structured fields. amount / order_ref /
// reference come from the (admin-correctable) payment row; the slip is the truth
// for the method breakdown and the date.
//
// STATE: a raw `erp_sync` jsonb column on connect.payment, kept OUT of db/schema.ts
// on purpose (like member.division): Drizzle selects every schema column on every
// read, so a column the Drizzle schema knows but the live DB has not grown yet would
// 500 every payments read on a deploy that lands before the migration. Only this
// module touches erp_sync, and only through raw SQL.

import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { rawFetch } from "@/lib/raw-fetch";
import { downloadMedia, mediaIdOf } from "@/lib/whatsapp/download";
import { readReceipt, receiptVisionConfigured, type ReceiptReading } from "@/lib/receipt-vision";
import {
  buildPaymentBody,
  interpretErpResponse,
  type ErpPaymentBody,
  type ErpResponseJson,
  type ErpSyncState,
} from "./erp-payments-core";

export type {
  ErpPaymentBody,
  ErpSyncState,
  PayMethod,
  BuildInput,
  BuildResult,
  ErpOutcome,
  ResolvedMethod,
} from "./erp-payments-core";
export { buildPaymentBody, interpretErpResponse, resolveMethod, normalizeCurrency, mapBankToErpCode, mapOnlineType, ALLOWED_SLIP_MIME, MAX_SLIP_BYTES } from "./erp-payments-core";

const DEFAULT_ERP_BASE = "https://erp.houzscentury.com";
const PUSH_PATH = "/api/connect/payments";
/** A hung ERP must never wedge the push (the automation REST node uses the same). */
export const PUSH_TIMEOUT_MS = 15_000;

// ─────────────────────────── IO: transport ───────────────────────────

interface ErpConfig {
  token: string;
  url: string; // absolute, passed through unchanged over the binding too
  binding?: { fetch: (input: string | Request, init?: RequestInit) => Promise<Response> };
}

/** Resolve token + URL + the ERP Service Binding (absent off the Worker). */
function erpConfig(): ErpConfig | { error: string } {
  let env: CloudflareEnv | undefined;
  try {
    env = getCloudflareContext().env;
  } catch {
    env = undefined; // not inside the Worker (scripts / tests)
  }
  const token = env?.ERP_SERVICE_TOKEN ?? process.env.ERP_SERVICE_TOKEN;
  if (!token) return { error: "ERP_SERVICE_TOKEN is not configured." };
  const base = (env?.ERP_API_BASE || process.env.ERP_API_BASE || DEFAULT_ERP_BASE).replace(/\/+$/, "");
  return { token, url: `${base}${PUSH_PATH}`, binding: env?.ERP };
}

interface ErpHttpResult {
  httpStatus: number | null;
  json: ErpResponseJson | null;
  /** Transport-level failure (no response): a reason to retry. */
  transportError?: string;
}

async function postToErp(cfg: ErpConfig, body: ErpPaymentBody): Promise<ErpHttpResult> {
  const doFetch = cfg.binding ? cfg.binding.fetch.bind(cfg.binding) : rawFetch();
  try {
    const res = await doFetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    let json: ErpResponseJson | null = null;
    try {
      json = (await res.json()) as ErpResponseJson;
    } catch {
      json = null; // non-JSON body (e.g. an edge 400) — interpret by status alone
    }
    return { httpStatus: res.status, json };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { httpStatus: null, json: null, transportError: timedOut ? `timeout after ${PUSH_TIMEOUT_MS}ms` : err?.message || String(e) };
  }
}

// ─────────────────────────── IO: DB state ───────────────────────────

/** Memoised per isolate: ALTER takes an ACCESS EXCLUSIVE lock even as a no-op. */
let ensured: Promise<void> | null = null;
export async function ensurePaymentErpColumns(db: DB): Promise<void> {
  if (!ensured) {
    ensured = db
      .execute(sql`ALTER TABLE "connect"."payment" ADD COLUMN IF NOT EXISTS "erp_sync" jsonb`)
      .then(() => undefined)
      .catch((e) => {
        ensured = null; // never cache a rejection
        throw e;
      });
  }
  await ensured;
}

interface PaymentPushRow {
  id: string;
  amount: number | null;
  currency: string | null;
  method: string | null;
  reference_no: string | null;
  order_ref: string | null;
  receipt_media_url: string | null;
  created_at: Date;
  status: string;
  contact_name: string | null;
  contact_phone: string;
  erp_company_id: number | null;
  erp_sync: ErpSyncState | null;
}

async function loadPaymentForPush(db: DB, paymentId: string): Promise<PaymentPushRow | null> {
  const rows = (await db.execute(sql`
    select p.id, p.amount, p.currency, p.method, p.reference_no, p.order_ref,
           p.receipt_media_url, p.created_at, p.status,
           c.name as contact_name, c.phone as contact_phone,
           co.erp_company_id, p.erp_sync
    from connect.payment p
    join connect.contact c on c.id = p.contact_id
    left join connect.company co on co.id = c.company_id
    where p.id = ${paymentId}
  `)) as unknown as PaymentPushRow[];
  return rows[0] ?? null;
}

async function writeSyncState(db: DB, paymentId: string, state: ErpSyncState): Promise<void> {
  await db.execute(sql`update connect.payment set erp_sync = ${JSON.stringify(state)}::jsonb where id = ${paymentId}`);
}

/** One System Logs row per push attempt, mirroring the cron tick's logging. */
async function logPush(db: DB, paymentId: string, outcome: string, detail: Record<string, unknown>): Promise<void> {
  try {
    await db.execute(sql`
      insert into connect.webhook_event (id, source, event_type, payload, processed, created_at)
      values (${createId()}, 'erp-payment-push', ${`payment:${outcome}`},
              ${JSON.stringify({ paymentId, ...detail })}::jsonb, true, now())
    `);
  } catch {
    // Logging must never fail the push.
  }
}

// ─────────────────────────── IO: slip + reading ───────────────────────────

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i += 0x8000) bin += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The slip's printed date is preferred; this is the fallback (KL day). */
function klDate(d: Date): string {
  // en-CA gives YYYY-MM-DD; Asia/Kuala_Lumpur is the showroom's day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ─────────────────────────── Orchestrator ───────────────────────────

export type PushResult = { done: "synced" | "pending" | "blocked" | "skipped"; reason?: string };

/**
 * Push one VERIFIED payment to the ERP and record the outcome. Idempotent: a
 * payment already SYNCED is skipped, and the ERP de-dupes on connect_payment_id
 * anyway. Never throws — every failure path writes a sync state and returns.
 */
export async function pushPaymentToErp(paymentId: string): Promise<PushResult> {
  const db = getDb();
  await ensurePaymentErpColumns(db);

  const row = await loadPaymentForPush(db, paymentId);
  if (!row) return { done: "skipped", reason: "not found" };
  if (row.status !== "VERIFIED") return { done: "skipped", reason: `status ${row.status}` };
  if (row.erp_sync?.status === "SYNCED") return { done: "skipped", reason: "already synced" };

  const prior = row.erp_sync;
  const attempts = (prior?.attempts ?? 0) + 1;
  const now = new Date().toISOString();
  const block = async (reason: string): Promise<PushResult> => {
    await writeSyncState(db, paymentId, { status: "BLOCKED", attempts, lastAttemptAt: now, reason, syncedAt: null });
    await logPush(db, paymentId, "blocked", { reason, attempts });
    return { done: "blocked", reason };
  };
  const pend = async (reason: string): Promise<PushResult> => {
    await writeSyncState(db, paymentId, { status: "PENDING", attempts, lastAttemptAt: now, reason, syncedAt: null });
    await logPush(db, paymentId, "pending", { reason, attempts });
    return { done: "pending", reason };
  };

  // Config / transport first: no token means retry once set, not a blocked payment.
  const cfg = erpConfig();
  if ("error" in cfg) return pend(cfg.error);

  // Slip bytes (needed for slip_base64) + the fresh reading off the same image.
  const mediaId = mediaIdOf(row.receipt_media_url);
  if (!mediaId) return block("No payment slip image to send.");
  const file = await downloadMedia(mediaId);
  if (!file.ok) {
    // Gone (404) is permanent; a 5xx/timeout from Meta is transient.
    return file.status === 404 ? block("The payment slip image is no longer available on WhatsApp.") : pend(`Could not fetch the slip image: ${file.error}`);
  }
  const mime = file.mimeType.split(";")[0].trim().toLowerCase();
  let reading: ReceiptReading | null = null;
  if (receiptVisionConfigured() && (mime.startsWith("image/") || mime === "application/pdf")) {
    const res = await readReceipt(file.bytes, file.mimeType);
    if (res.status === "read") reading = res.reading;
  }

  const build = buildPaymentBody({
    paymentId: row.id,
    erpCompanyId: row.erp_company_id,
    orderRef: row.order_ref,
    amount: row.amount,
    currency: row.currency,
    storedMethod: row.method,
    reference: row.reference_no,
    reading,
    slip: { base64: toBase64(file.bytes), mime, bytes: file.bytes.byteLength },
    paidAtFallback: klDate(row.created_at instanceof Date ? row.created_at : new Date(row.created_at)),
    customerPhone: row.contact_phone,
    customerName: row.contact_name,
  });
  if (!build.ok) return block(build.reason);

  const http = await postToErp(cfg, build.body);
  if (http.httpStatus == null) return pend(http.transportError || "No response from the ERP.");

  const outcome = interpretErpResponse(http.httpStatus, http.json);
  if (outcome.kind === "synced") {
    await writeSyncState(db, paymentId, {
      status: "SYNCED",
      attempts,
      lastAttemptAt: now,
      syncedAt: now,
      erpStatus: outcome.erpStatus,
      erpPaymentRef: outcome.erpPaymentRef,
      soNo: outcome.soNo,
      reason: outcome.idempotent ? "Already recorded in the ERP." : null,
    });
    await logPush(db, paymentId, "synced", {
      attempts,
      erpStatus: outcome.erpStatus,
      erpPaymentRef: outcome.erpPaymentRef,
      soNo: outcome.soNo,
      idempotent: outcome.idempotent,
    });
    return { done: "synced" };
  }
  if (outcome.kind === "blocked") return block(outcome.reason);
  return pend(outcome.reason);
}

/**
 * Mark a just-confirmed payment PENDING and push it in the background. Call this
 * right after a payment becomes VERIFIED. Returns at once: the PENDING state is
 * written synchronously (so the Payments page shows "sending"), and the push runs
 * in waitUntil (await off the Worker, e.g. scripts/tests). Idempotent — a payment
 * already SYNCED is left alone.
 */
export async function onPaymentVerified(db: DB, paymentId: string): Promise<void> {
  try {
    await ensurePaymentErpColumns(db);
    const rows = (await db.execute(sql`select status, erp_sync from connect.payment where id = ${paymentId}`)) as unknown as {
      status: string;
      erp_sync: ErpSyncState | null;
    }[];
    const r = rows[0];
    if (!r || r.status !== "VERIFIED") return;
    if (r.erp_sync?.status === "SYNCED") return; // pushed once already
    await writeSyncState(db, paymentId, {
      status: "PENDING",
      attempts: r.erp_sync?.attempts ?? 0,
      lastAttemptAt: new Date().toISOString(),
      reason: "Confirmed — sending to the ERP.",
      syncedAt: null,
    });
  } catch (e) {
    console.warn("[erp-payment] could not queue push:", e);
    return;
  }

  const job = pushPaymentToErp(paymentId).catch((e) => console.error("ERP_PAYMENT_PUSH_FAIL", e));
  try {
    getCloudflareContext().ctx.waitUntil(job);
  } catch {
    await job; // not inside the Worker request context (scripts / tests)
  }
}

/**
 * Cron sweep: re-push every payment still PENDING (a transient ERP error, or a
 * push that fired before the ERP endpoint was merged), oldest first, with the
 * SAME connect_payment_id. BLOCKED and SYNCED rows are left alone. Returns counts.
 */
export async function sweepPendingPaymentPushes(limit = 50): Promise<{ attempted: number; synced: number; pending: number; blocked: number }> {
  const db = getDb();
  await ensurePaymentErpColumns(db);
  const due = (await db.execute(sql`
    select id from connect.payment
    where status = 'VERIFIED' and (erp_sync->>'status') = 'PENDING'
    order by (erp_sync->>'lastAttemptAt') asc nulls first
    limit ${limit}
  `)) as unknown as { id: string }[];

  const counts = { attempted: 0, synced: 0, pending: 0, blocked: 0 };
  for (const { id } of due) {
    counts.attempted++;
    const res = await pushPaymentToErp(id);
    if (res.done === "synced") counts.synced++;
    else if (res.done === "blocked") counts.blocked++;
    else counts.pending++;
  }
  return counts;
}

// WhatsApp message templates, over the Meta Graph API.
//
// Templates are the ONLY way to open a conversation: outside the 24-hour
// customer-service window Meta rejects free-form text, and every delivery
// notice, reminder, reschedule and balance-collection message this system
// sends is business-initiated. So this module is not a nicety — without it
// Connect can only reply, never start.
//
// The template itself always lives in Meta (a WABA asset, reviewed by Meta,
// typically within 24h). Every WABA platform — Seampify included — is a UI
// over these same endpoints; `syncTemplates` is the equivalent of Seampify's
// "Synchronize with Facebook" button.
//
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates

const GRAPH = "https://graph.facebook.com/v21.0";

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";
export type TemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "IN_APPEAL"
  | "PENDING_DELETION";

export interface TemplateButton {
  /** Only quick replies for now — that is what the migrated flows use
   *  ("Confirm Date" / "Amend Date"), and they are what the engine can
   *  resume a run on. URL/phone buttons would not drive a flow. */
  type: "QUICK_REPLY";
  text: string;
}

export interface TemplateDraft {
  /** Lowercase letters, digits and underscores only — Meta rejects anything else. */
  name: string;
  language: string;
  category: TemplateCategory;
  /** Body copy with {{1}}, {{2}}, … placeholders, in order. */
  body: string;
  /** One sample value per placeholder. Meta REQUIRES these when the body has
   *  placeholders and rejects the whole template without them. */
  examples?: string[];
  buttons?: TemplateButton[];
  footer?: string;
  /**
   * Bold line above the body. TEXT headers only, and STATIC only — a header may
   * carry its own {{1}}, but Meta numbers header parameters in a SEPARATE
   * sequence from body parameters, so a variable here would silently shift what
   * the body's {{1}} means. Every placeholder in this app is a body parameter;
   * keeping the header static is what makes that true.
   *
   * Seampify's approved `overdue_order_status_update` has one
   * ("Order Update from Houzs Century"); the version submitted from Connect
   * does not.
   */
  header?: string;
}

/** Meta's own limits, as shown by Seampify's character counters. */
export const LIMITS = {
  name: 512,
  header: 60,
  body: 1024,
  footer: 60,
  button: 25,
  buttonCount: 3,
} as const;

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  body: string;
  buttons: string[];
  /** Bold line above the body. Empty when the template has none. */
  header: string;
  /** The small grey line under the body. Empty when the template has none. */
  footer: string;
  /**
   * Meta holds an IMAGE / VIDEO / DOCUMENT header this editor cannot represent.
   * An edit REPLACES every component, so editing such a template here would
   * delete its media header — the UI blocks the edit instead.
   */
  mediaHeader: boolean;
  /** Meta's reason when status is REJECTED — the whole point of showing status. */
  rejectedReason?: string | null;
}

// ─────────────────────────── Editing ───────────────────────────
//
// Meta: "Only templates with an APPROVED, REJECTED, or PAUSED status can be
// edited." A template under review cannot be — which is why the six templates
// submitted last week show no Edit action, and why the UI has to SAY so instead
// of just hiding the button.
//
// Also from Meta: an approved template may be edited up to 10 times in a 30-day
// window and once in 24 hours; rejected/paused ones an unlimited number of
// times. After editing an approved or paused template Meta re-approves it
// automatically unless it fails review.

export const EDITABLE_STATUSES: TemplateStatus[] = ["APPROVED", "REJECTED", "PAUSED"];

export function canEditTemplate(status: TemplateStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * Why this template cannot be edited, in words an operator can act on.
 * Null when it CAN be edited.
 */
export function editBlockedReason(status: TemplateStatus): string | null {
  switch (status) {
    case "APPROVED":
    case "REJECTED":
    case "PAUSED":
      return null;
    case "PENDING":
      return "Meta is still reviewing this template. A template under review cannot be changed — Meta only allows edits once it is approved, rejected or paused. Review usually finishes within 24 hours; this page shows the new status as soon as it does.";
    case "IN_APPEAL":
      return "This template is in appeal with Meta. It cannot be changed until the appeal is decided.";
    case "PENDING_DELETION":
      return "This template is queued for deletion at Meta and can no longer be changed.";
    case "DISABLED":
      return "Meta disabled this template, usually after repeated low-quality or blocked feedback from customers. Disabled templates cannot be edited — create a new one with different copy.";
    default:
      return "Meta only allows a template to be edited while it is approved, rejected or paused.";
  }
}

export interface TemplateApiConfig {
  wabaId: string;
  token: string;
}

/** Read the WABA credentials from the environment. Null when not configured —
 *  callers surface that as "not connected yet" rather than throwing. */
export function templateConfig(): TemplateApiConfig | null {
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!wabaId || !token) return null;
  return { wabaId, token };
}

/** Meta's name rules, applied before we ask (a 400 here is slow and opaque). */
export function normaliseTemplateName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

/**
 * How many parameters this body needs — the HIGHEST placeholder number, not the
 * count of distinct ones.
 *
 * Meta fills parameters strictly in order, so a body using {{1}} and {{3}}
 * needs three of them; counting two would send {{3}}'s value into {{2}}. For a
 * well-formed template (numbered 1..n with no gaps, which is all Meta accepts)
 * the two counts are identical.
 */
export function countPlaceholders(body: string): number {
  let max = 0;
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) max = Math.max(max, Number(m[1]));
  return max;
}

interface GraphError {
  error?: { message?: string; error_user_msg?: string; code?: number };
}

async function graph<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      ok: false,
      error: err?.name === "TimeoutError" ? "Meta did not respond in time." : (err?.message ?? "Network error"),
    };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body — fall through to the raw text as the error.
  }
  if (!res.ok) {
    const g = json as GraphError | null;
    // error_user_msg is the human-readable one Meta shows in its own UI; the
    // generic `message` is usually "(#100) Invalid parameter", which helps nobody.
    return {
      ok: false,
      error: g?.error?.error_user_msg || g?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data: (json ?? {}) as T };
}

interface RawComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text: string }[];
}
interface RawTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  components?: RawComponent[];
  rejected_reason?: string | null;
}

function flatten(t: RawTemplate): RemoteTemplate {
  const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
  const footer = t.components?.find((c) => c.type === "FOOTER")?.text ?? "";
  // TEXT headers only — an IMAGE/VIDEO/DOCUMENT header has no `text`, and this
  // app has nowhere to put one. Reported as absent rather than as an empty
  // string that an edit would then silently delete.
  const rawHeader = t.components?.find((c) => c.type === "HEADER");
  const header = rawHeader && (rawHeader.format ?? "TEXT") === "TEXT" ? (rawHeader.text ?? "") : "";
  const buttons =
    t.components
      ?.find((c) => c.type === "BUTTONS")
      ?.buttons?.map((b) => b.text) ?? [];
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    body,
    header,
    footer,
    buttons,
    /** True when Meta holds a non-text header this editor cannot round-trip. */
    mediaHeader: !!rawHeader && (rawHeader.format ?? "TEXT") !== "TEXT",
    rejectedReason: t.rejected_reason ?? null,
  };
}

/** Every template on the WABA, newest first. Seampify's "Synchronize". */
export async function listTemplates(
  cfg: TemplateApiConfig
): Promise<{ ok: true; templates: RemoteTemplate[] } | { ok: false; error: string }> {
  const url = `${GRAPH}/${cfg.wabaId}/message_templates?limit=200&fields=id,name,language,category,status,components,rejected_reason`;
  const res = await graph<{ data?: RawTemplate[] }>(url, cfg.token);
  if (!res.ok) return res;
  return { ok: true, templates: (res.data.data ?? []).map(flatten) };
}

/**
 * Submit a template for Meta review. Returns its id and initial status
 * (PENDING for anything with copy Meta has not seen before).
 */
/**
 * BODY / FOOTER / BUTTONS in the shape Meta wants, shared by create and edit.
 * An edit REPLACES every component, so both paths must build the full set —
 * omitting the footer on an edit would delete the footer.
 */
function buildComponents(
  draft: TemplateDraft
): { ok: true; components: Record<string, unknown>[] } | { ok: false; error: string } {
  const placeholders = countPlaceholders(draft.body);
  const examples = (draft.examples ?? []).map((e) => e.trim()).filter(Boolean);
  if (placeholders > 0 && examples.length < placeholders) {
    return {
      ok: false,
      error: `This body uses ${placeholders} variable(s); Meta needs a sample value for each before it will review it.`,
    };
  }

  const header = draft.header?.trim();
  if (header && /\{\{\s*\d+\s*\}\}/.test(header)) {
    return {
      ok: false,
      error:
        "A header cannot contain a variable here. Meta numbers header parameters separately from body parameters, so a {{1}} in the header would change what the body's {{1}} means. Keep the header as fixed text.",
    };
  }

  const components: Record<string, unknown>[] = [];
  if (header) {
    components.push({ type: "HEADER", format: "TEXT", text: header });
  }
  components.push({
    type: "BODY",
    text: draft.body,
    ...(placeholders > 0
      ? { example: { body_text: [examples.slice(0, placeholders)] } }
      : {}),
  });
  if (draft.footer?.trim()) {
    components.push({ type: "FOOTER", text: draft.footer.trim() });
  }
  if (draft.buttons?.length) {
    components.push({
      type: "BUTTONS",
      // Meta caps quick replies at 3 per template.
      buttons: draft.buttons.slice(0, 3).map((b) => ({
        type: "QUICK_REPLY",
        text: b.text.slice(0, 25),
      })),
    });
  }
  return { ok: true, components };
}

export async function createTemplate(
  cfg: TemplateApiConfig,
  draft: TemplateDraft
): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  const name = normaliseTemplateName(draft.name);
  if (!name) return { ok: false, error: "Template name is empty after cleaning." };

  const built = buildComponents(draft);
  if (!built.ok) return built;
  const components = built.components;

  return graph<{ id: string; status: string }>(
    `${GRAPH}/${cfg.wabaId}/message_templates`,
    cfg.token,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        language: draft.language,
        category: draft.category,
        components,
      }),
    }
  ).then((r) =>
    r.ok
      ? ({ ok: true, id: r.data.id, status: r.data.status ?? "PENDING" } as const)
      : r
  );
}

/**
 * Edit an existing template: POST /{template-id} with the changed components.
 *
 * What CANNOT change: the name and the language — those identify the template,
 * and Meta's update endpoint does not accept them. Category is deliberately not
 * sent either: Meta refuses a category change on an already-approved template,
 * and a rejected one is better re-categorised by creating a new template than by
 * silently changing what the customer's phone labels the message as.
 *
 * Components are REPLACED wholesale, not merged — so the caller must pass the
 * complete body + footer + buttons, including the parts it did not change.
 * `status` is the caller's current view of the template; it is checked here as
 * well as in the UI, because "the button was hidden" is not a guarantee.
 */
export async function updateTemplate(
  cfg: TemplateApiConfig,
  templateId: string,
  status: TemplateStatus,
  draft: TemplateDraft
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!templateId) return { ok: false, error: "This template has no Meta id — reload the page." };
  const blocked = editBlockedReason(status);
  if (blocked) return { ok: false, error: blocked };

  const built = buildComponents(draft);
  if (!built.ok) return built;

  const res = await graph<{ success?: boolean }>(`${GRAPH}/${templateId}`, cfg.token, {
    method: "POST",
    body: JSON.stringify({ components: built.components }),
  });
  return res.ok ? { ok: true } : res;
}

// ───────────────────── Delivery analytics ─────────────────────
//
// Seampify's template list carries two columns this one did not: "Message
// delivered" and "Message read rate" (e.g. 404 delivered, 65.10% (263) read —
// 263/404, so the rate is read ÷ delivered, not read ÷ sent).
//
// Both come from the WABA's `template_analytics` edge:
//
//   GET /{waba-id}/template_analytics
//       ?start=<unix seconds>&end=<unix seconds>
//       &granularity=DAILY
//       &metric_types=["SENT","DELIVERED","READ"]
//       &template_ids=["<id>", …]           ← at most 10 per request
//
// returning one bucket per template per day:
//
//   { "data": [ { "granularity": "DAILY", "data_points":
//       [ { "template_id": "…", "start": …, "end": …,
//           "sent": 2, "delivered": 2, "read": 1 } ] } ] }
//
// Two things gate it, and BOTH may be missing on this account:
//   1. the token needs the `whatsapp_business_analytics` permission;
//   2. analytics has to be switched on for the WABA itself.
//
// Neither is fixable from here, and neither is fixed from here: everything
// below is a GET. When Meta refuses, the refusal is carried back in words —
// never flattened into a zero. A template that has genuinely sent nothing and a
// template whose numbers we are not allowed to read must not look the same on
// screen; that confusion is exactly how this system spent a day looking healthy
// while sending nothing.
//
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics

/** What Meta counted for one template over the window asked for. */
export interface TemplateCounts {
  sent: number;
  delivered: number;
  read: number;
}

/** One template's outcome: the counts, or why there are none to show. */
export type TemplateStats =
  | { ok: true; counts: TemplateCounts }
  | { ok: false; error: string };

export type AnalyticsRefusalKind =
  | "NO_PERMISSION"
  | "NOT_ENABLED"
  | "UNSUPPORTED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "EMPTY"
  | "UNKNOWN";

export interface AnalyticsRefusal {
  kind: AnalyticsRefusalKind;
  /** What it means and what a human would have to do, in plain language. */
  message: string;
  /** Meta's own sentence, verbatim — nothing is paraphrased away. */
  detail: string;
}

export interface TemplateAnalytics {
  /** The window every number here is FOR, as unix seconds. */
  start: number;
  end: number;
  days: number;
  /** Per Meta template id. A template absent from this map was never asked about. */
  stats: Map<string, TemplateStats>;
  /** Set when the WHOLE read failed the same way — one banner, not 64 chips. */
  refusal: AnalyticsRefusal | null;
  /** Set when the counts may be short (paging was cut off). */
  incomplete: string | null;
}

/** Meta's cap: at most 10 template ids per template_analytics request. */
const ANALYTICS_BATCH = 10;

/**
 * How far back to count. Meta keeps template analytics for 90 days, so a longer
 * window would silently return less than it claims to cover.
 */
export const ANALYTICS_DAYS = 30;

/** Stop following paging cursors here rather than looping on a broken `next`. */
const ANALYTICS_MAX_PAGES = 20;

/**
 * Turn Meta's refusal into something an operator can act on, WITHOUT losing
 * Meta's own words — the generic `message` is often "(#100) Invalid parameter",
 * and the useful sentence is whichever one Meta actually sent.
 */
function classifyAnalyticsError(detail: string): AnalyticsRefusal {
  const t = detail.toLowerCase();

  if (t.includes("whatsapp_business_analytics") || (t.includes("permission") && t.includes("analytic"))) {
    return {
      kind: "NO_PERMISSION",
      detail,
      message:
        "The access token this Worker uses is not allowed to read template analytics. Meta requires the whatsapp_business_analytics permission on the system user, and this token does not carry it. Delivered and read counts stay blank until someone grants it in Meta Business Settings and issues a new token — nothing here can grant it, and nothing was changed at Meta.",
    };
  }

  if (
    t.includes("is_enabled_for_insights") ||
    t.includes("not enabled for insights") ||
    t.includes("insights is not enabled") ||
    t.includes("analytics is not enabled") ||
    t.includes("enable analytics")
  ) {
    return {
      kind: "NOT_ENABLED",
      detail,
      message:
        "Analytics is switched off for this WhatsApp Business Account, so Meta holds no delivered or read counts to give. Turning it on is a one-way change to the WABA itself and is deliberately not done from here — an admin has to enable it in WhatsApp Manager, after which counts start accruing from that moment (it is not backfilled).",
    };
  }

  if (
    t.includes("unsupported get request") ||
    t.includes("does not exist") ||
    t.includes("nonexisting field") ||
    t.includes("unknown path components") ||
    t.includes("cannot be loaded from the api")
  ) {
    return {
      kind: "UNSUPPORTED",
      detail,
      message:
        "Meta says this WhatsApp Business Account has no template_analytics endpoint to read — which is what it answers both when the edge is unavailable to the account and when the token cannot see the account at all. No counts can be shown until Meta answers that call.",
    };
  }

  if (t.includes("rate limit") || t.includes("too many calls") || t.includes("request limit")) {
    return {
      kind: "RATE_LIMITED",
      detail,
      message:
        "Meta is rate-limiting this account's analytics calls, so the counts could not be read this time. This is temporary — reload in a few minutes. The numbers are not zero; they are unknown.",
    };
  }

  if (t.includes("did not respond in time") || t.includes("network") || t.includes("fetch failed")) {
    return {
      kind: "NETWORK",
      detail,
      message:
        "Meta could not be reached for the delivery counts. The templates themselves listed fine, so this is the analytics call alone — reload to try again. The numbers are unknown, not zero.",
    };
  }

  return {
    kind: "UNKNOWN",
    detail,
    message:
      "Meta refused the delivery-count request and its reason is below, unedited. Until it answers, delivered and read counts are unknown for every template — they are not zero.",
  };
}

interface RawAnalyticsPoint {
  template_id?: string;
  sent?: number;
  delivered?: number;
  read?: number;
}
interface RawAnalyticsResponse {
  data?: { granularity?: string; data_points?: RawAnalyticsPoint[] }[];
  paging?: { next?: string };
}

/** A number Meta may have sent as a string, or not sent at all. */
function count(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One batch of up to 10 template ids, following paging until Meta runs out.
 *
 * Paging is followed only to graph.facebook.com. `paging.next` arrives inside a
 * response body — it is data, not an instruction — so it is not a URL this code
 * will chase anywhere Meta did not send it.
 */
async function analyticsBatch(
  cfg: TemplateApiConfig,
  ids: string[],
  start: number,
  end: number
): Promise<{ ok: true; points: RawAnalyticsPoint[]; truncated: boolean } | { ok: false; error: string }> {
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    granularity: "DAILY",
    metric_types: JSON.stringify(["SENT", "DELIVERED", "READ"]),
    template_ids: JSON.stringify(ids),
  });

  let url: string | null = `${GRAPH}/${cfg.wabaId}/template_analytics?${params.toString()}`;
  const points: RawAnalyticsPoint[] = [];

  for (let page = 0; page < ANALYTICS_MAX_PAGES && url; page++) {
    const res: { ok: true; data: RawAnalyticsResponse } | { ok: false; error: string } =
      await graph<RawAnalyticsResponse>(url, cfg.token);
    if (!res.ok) return res;
    for (const bucket of res.data.data ?? []) {
      for (const p of bucket.data_points ?? []) points.push(p);
    }
    // Annotated, not inferred: `url` is reassigned from this and read back at
    // the top of the loop, and letting TS infer both ends of that circle is a
    // TS7022 ("implicitly has type any in its own initializer").
    const next: string | undefined = res.data.paging?.next;
    url = typeof next === "string" && next.startsWith("https://graph.facebook.com/") ? next : null;
  }

  return { ok: true, points, truncated: url !== null };
}

/**
 * Delivered / read counts for the given templates over the last ANALYTICS_DAYS.
 *
 * The map is keyed by Meta template id and every requested id appears in it, so
 * the caller can never mistake "not asked about" for "zero". Within a batch that
 * SUCCEEDED, a template with no data point really did send nothing in the
 * window; within a batch that failed, every template in it carries the failure
 * instead of a number.
 */
export async function fetchTemplateAnalytics(
  cfg: TemplateApiConfig,
  templateIds: string[],
  days: number = ANALYTICS_DAYS
): Promise<TemplateAnalytics> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86_400;
  const ids = [...new Set(templateIds.filter(Boolean))];
  const stats = new Map<string, TemplateStats>();
  const base: TemplateAnalytics = { start, end, days, stats, refusal: null, incomplete: null };
  if (ids.length === 0) return base;

  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += ANALYTICS_BATCH) {
    batches.push(ids.slice(i, i + ANALYTICS_BATCH));
  }

  // A stats column must never be able to take the page down with it: the
  // template list, status and editing come from a different call that works.
  let results: Awaited<ReturnType<typeof analyticsBatch>>[];
  try {
    results = await Promise.all(batches.map((b) => analyticsBatch(cfg, b, start, end)));
  } catch (e) {
    return { ...base, refusal: classifyAnalyticsError(e instanceof Error ? e.message : String(e)) };
  }

  let failed = 0;
  let firstError = "";
  let truncated = false;
  let anyPoint = false;

  results.forEach((res, i) => {
    const batch = batches[i];
    if (!res.ok) {
      failed++;
      if (!firstError) firstError = res.error;
      for (const id of batch) stats.set(id, { ok: false, error: res.error });
      return;
    }
    // The call worked, so a template with no rows genuinely sent nothing.
    for (const id of batch) stats.set(id, { ok: true, counts: { sent: 0, delivered: 0, read: 0 } });
    if (res.truncated) truncated = true;
    for (const p of res.points) {
      const id = p.template_id;
      if (!id) continue;
      const cur = stats.get(id);
      if (!cur || !cur.ok) continue;
      anyPoint = true;
      cur.counts.sent += count(p.sent);
      cur.counts.delivered += count(p.delivered);
      cur.counts.read += count(p.read);
    }
  });

  if (failed === batches.length) {
    return { ...base, refusal: classifyAnalyticsError(firstError || "Meta gave no reason.") };
  }

  /**
   * Every call succeeded and Meta returned not one row for anything.
   *
   * That is ALSO what an account with analytics switched off answers — Meta
   * returns 200 with an empty payload rather than an error — so painting 0
   * delivered across the whole list would be asserting something this response
   * cannot support. One row anywhere proves the edge is live and reporting, and
   * then the zeros beside it are real.
   */
  if (!anyPoint && failed === 0) {
    return {
      ...base,
      refusal: {
        kind: "EMPTY",
        detail: "HTTP 200 with no data points for any template.",
        message:
          `Meta accepted the request and returned no delivery rows at all for the last ${days} days. ` +
          "That is the same answer an account gives when analytics is switched off for it, so these cannot be reported as zeros — a template that sent nothing and a template Meta is not counting would look identical. Until one row comes back, delivered and read are unknown.",
      },
    };
  }

  return {
    ...base,
    incomplete: truncated
      ? `Meta had more analytics pages than this page reads (${ANALYTICS_MAX_PAGES}), so the counts below are a floor, not a total.`
      : null,
  };
}

/** Read ÷ delivered — the rate Seampify shows. Null when nothing was delivered. */
export function readRate(counts: TemplateCounts): number | null {
  if (counts.delivered <= 0) return null;
  return counts.read / counts.delivered;
}

/** Delete a template by name (Meta deletes every language variant of it). */
export async function deleteTemplate(
  cfg: TemplateApiConfig,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${GRAPH}/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`;
  const res = await graph<{ success?: boolean }>(url, cfg.token, { method: "DELETE" });
  return res.ok ? { ok: true } : res;
}

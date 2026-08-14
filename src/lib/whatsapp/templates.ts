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
}

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  body: string;
  buttons: string[];
  /** Meta's reason when status is REJECTED — the whole point of showing status. */
  rejectedReason?: string | null;
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

/** How many {{n}} placeholders the body actually uses. */
export function countPlaceholders(body: string): number {
  const seen = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) seen.add(Number(m[1]));
  return seen.size;
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
    buttons,
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
export async function createTemplate(
  cfg: TemplateApiConfig,
  draft: TemplateDraft
): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  const name = normaliseTemplateName(draft.name);
  if (!name) return { ok: false, error: "Template name is empty after cleaning." };

  const placeholders = countPlaceholders(draft.body);
  const examples = (draft.examples ?? []).map((e) => e.trim()).filter(Boolean);
  if (placeholders > 0 && examples.length < placeholders) {
    return {
      ok: false,
      error: `This body uses ${placeholders} variable(s); Meta needs a sample value for each before it will review it.`,
    };
  }

  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: draft.body,
      ...(placeholders > 0
        ? { example: { body_text: [examples.slice(0, placeholders)] } }
        : {}),
    },
  ];
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

/** Delete a template by name (Meta deletes every language variant of it). */
export async function deleteTemplate(
  cfg: TemplateApiConfig,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${GRAPH}/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`;
  const res = await graph<{ success?: boolean }>(url, cfg.token, { method: "DELETE" });
  return res.ok ? { ok: true } : res;
}

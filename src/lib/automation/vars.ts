import { attrs } from "@/lib/format";

export interface VarContext {
  full_name?: string | null;
  phone?: string;
  attributes?: unknown;
  /** Columns on the contact row. Optional so existing callers keep compiling —
   *  a built-in nobody supplied resolves to "" and is reported as blank, never
   *  invented. */
  email?: string | null;
  source?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  /** The AutomationRun id, when interpolating inside a run. Lets a
   *  call_rest_api body carry an idempotency key ({run_id}) that is the same on
   *  a retry of the same step and different for every conversation. */
  run_id?: string | null;
}

/**
 * Sources every contact has, whatever custom fields a company configured.
 *
 * Named and ordered after Seampify's "Attribute Placeholder" dropdown, which is
 * the list the owner already knows. Seampify's list also carries CONVERSATION
 * values (Last Message Assigned To Name/Email/Phone/Department, In Queue, Tags)
 * and Company / Address / City / State / Zipcode / Remarks. Connect has no
 * column or context for those yet, so they are deliberately NOT offered: an
 * option that silently resolves to "-" is the exact bug this whole change
 * exists to remove. Add them here only together with the code that fills them.
 */
export const BUILT_IN_FIELDS: { key: string; name: string }[] = [
  { key: "phone", name: "Phone Number" },
  { key: "full_name", name: "Full Name" },
  { key: "first_name", name: "First Name" },
  { key: "last_name", name: "Last Name" },
  { key: "email", name: "Email" },
  { key: "source", name: "Source Type" },
  { key: "source_id", name: "Source Id" },
  { key: "source_url", name: "Source Url" },
];

function buildLookup(ctx: VarContext): Record<string, string> {
  const full = (ctx.full_name ?? "").trim();
  const space = full.indexOf(" ");
  return {
    // Custom attributes first: a built-in of the same key wins, matching
    // Seampify, where Full Name is its own entry above the custom attributes.
    ...attrs(ctx.attributes),
    full_name: full,
    first_name: space === -1 ? full : full.slice(0, space),
    last_name: space === -1 ? "" : full.slice(space + 1).trim(),
    phone: ctx.phone ?? "",
    email: ctx.email ?? "",
    source: ctx.source ?? "",
    source_id: ctx.sourceId ?? "",
    source_url: ctx.sourceUrl ?? "",
    run_id: ctx.run_id ?? "",
  };
}

/**
 * Interpolate {key} and {{key}} placeholders in a message using the contact's
 * attributes plus a few built-ins (full_name, phone).
 */
export function interpolate(template: string, ctx: VarContext): string {
  const lookup = buildLookup(ctx);
  return template.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_m, key) => {
    const v = lookup[key];
    return v == null || v === "" ? `{${key}}` : String(v);
  });
}

/** Meta rejects an empty body parameter, so an unresolved variable sends this. */
const EMPTY_PARAM = "-";

// ─────────────────── Positional templates and their bindings ───────────────────
//
// A WhatsApp template approved by Meta numbers its variables POSITIONALLY:
// {{1}}, {{2}}, {{3}}. All six templates on this WABA are written that way.
// Nothing inside those braces says WHERE the value comes from — "{{2}}" is not
// a field name, it is a slot number — so the app has to carry that knowledge
// itself. That is what a VarBinding is: slot 2 ← contact field `ref_1`.
//
// Before this existed the send path looked "2" up as if it were a contact
// attribute, found nothing, and substituted "-" into every slot.

/** Where one {{n}} slot takes its value from. */
export type BindingSource = "field" | "builtin" | "literal";

export interface VarBinding {
  /** The {{n}} this fills — 1-based, exactly as Meta numbers its parameters. */
  index: number;
  source: BindingSource;
  /** `contact_field.key` for "field"; a BUILT_IN_FIELDS key for "builtin". */
  key?: string;
  /** The fixed text, for "literal". */
  value?: string;
  /** Seampify's "Placeholder Name": what a human calls this slot ("Customer
   *  name", "Reference no."). Display only — it never reaches Meta. */
  label?: string;
}

/** Runtime guard for a `bindings` jsonb column read back out of Postgres. */
export function asBindings(raw: unknown): VarBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: VarBinding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const b = r as Record<string, unknown>;
    const index = Number(b.index);
    const source = String(b.source ?? "");
    if (!Number.isInteger(index) || index < 1) continue;
    if (source !== "field" && source !== "builtin" && source !== "literal") continue;
    out.push({
      index,
      source,
      key: b.key == null ? undefined : String(b.key),
      value: b.value == null ? undefined : String(b.value),
      label: b.label == null ? undefined : String(b.label),
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The {{n}} slots a template body uses, ascending and de-duplicated. */
export function positionalSlots(body: string): number[] {
  const seen = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) seen.add(Number(m[1]));
  return [...seen].sort((a, b) => a - b);
}

/** True when the body is written Meta-style ({{1}}) rather than named ({{ref_1}}). */
export function isPositional(body: string): boolean {
  return positionalSlots(body).length > 0;
}

/**
 * How many parameters a body needs — the HIGHEST placeholder number, not the
 * count of distinct ones. Meta fills parameters strictly in order, so a body
 * using {{1}} and {{3}} still needs three of them; sending two would shift
 * {{3}}'s value into {{2}}.
 */
export function paramCount(body: string): number {
  const nums = positionalSlots(body);
  return nums.length === 0 ? 0 : nums[nums.length - 1];
}

/**
 * Whether a binding actually points at something.
 *
 * A row can exist with only a label on it — someone named the slot
 * ("Reference no.") and had not yet picked the field. That is NOT bound, and
 * counting it as bound would let the exact bug this file exists to fix back in
 * through the side door.
 */
export function isBound(b: VarBinding | undefined): boolean {
  if (!b) return false;
  if (b.source === "literal") return (b.value ?? "").trim() !== "";
  return (b.key ?? "").trim() !== "";
}

/**
 * Which {{n}} slots have no usable binding — the contact-independent check.
 *
 * Callers that can report a problem to a human (the campaign creator, the
 * templates page) run this FIRST and refuse rather than sending a message whose
 * every variable reads "-". A silent "-" is worse than a refusal: the customer
 * receives "Reference No. : -" and only finds out by asking.
 */
export function templateBindingGaps(body: string, bindings: VarBinding[] | null | undefined): number[] {
  // Slots actually written in the body, not 1..max — a gap a human cannot see
  // in the copy is not one they can act on. (Meta only approves bodies numbered
  // 1..n with no gaps, so for a real template the two are the same set.)
  const map = new Map((bindings ?? []).map((b) => [b.index, b]));
  return positionalSlots(body).filter((n) => !isBound(map.get(n)));
}

/**
 * Per-send overrides laid on top of a template's saved defaults, slot by slot.
 *
 * Seampify binds placeholders inside the CAMPAIGN wizard, not in the template
 * editor, so the same template can be sent twice with {{3}} pointed at two
 * different date fields. Connect keeps the template-level mapping as the
 * default — so an automated send has something sane without a human re-picking
 * four dropdowns every time — and lets a send override any subset of it.
 */
export function mergeBindings(
  defaults: VarBinding[] | null | undefined,
  overrides: VarBinding[] | null | undefined
): VarBinding[] {
  const out = new Map<number, VarBinding>();
  for (const b of defaults ?? []) out.set(b.index, b);
  for (const b of overrides ?? []) out.set(b.index, b);
  return [...out.values()].sort((a, b) => a.index - b.index);
}

/** One binding's raw value for a contact — "" when it resolves to nothing. */
export function resolveBinding(
  binding: VarBinding | undefined,
  lookup: Record<string, string>
): string {
  if (!binding) return "";
  if (binding.source === "literal") return binding.value ?? "";
  const key = binding.key;
  if (!key) return "";
  const v = lookup[key];
  return v == null ? "" : String(v);
}

/**
 * Meta rejects a parameter containing a newline or a tab, and rejects an empty
 * one outright — both come back as a 132000-class error with the whole send
 * lost, so they are normalised here rather than at the call site.
 *
 * Exported so the automation engine's send_template path cleans its params the
 * same way this (the campaign path) does — a multi-line field like {bank_block}
 * must arrive as a single line, or Meta refuses the whole template send.
 */
export function cleanParam(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean === "" ? EMPTY_PARAM : clean;
}

export interface ParamResolution {
  /** Body parameters IN ORDER, ready for the Cloud API. */
  params: string[];
  /** Slots that have no binding at all — the template was never mapped. */
  unbound: number[];
  /** Slots that ARE bound but resolved to nothing for THIS contact. */
  blank: number[];
}

/**
 * Resolve a template body's parameters for one contact.
 *
 * Positional body ({{1}}, {{2}}): every slot is filled from its binding.
 * Named body ({{full_name}}, {{ref_1}}): the placeholder text IS the attribute
 * key, so the bindings are not needed — this is the shape an operator types by
 * hand in the campaign composer, and it keeps working untouched.
 */
export function resolveSendParams(
  body: string,
  ctx: VarContext,
  bindings?: VarBinding[] | null
): ParamResolution {
  const lookup = buildLookup(ctx);
  const count = paramCount(body);

  if (count > 0) {
    const map = new Map((bindings ?? []).map((b) => [b.index, b]));
    const params: string[] = [];
    const unbound: number[] = [];
    const blank: number[] = [];
    // 1..highest, not the distinct slots: params are positional, so index 0 is
    // always {{1}} and a gap must still occupy its place in the array.
    for (let n = 1; n <= count; n++) {
      const b = map.get(n);
      const bound = isBound(b);
      if (!bound) unbound.push(n);
      const raw = resolveBinding(b, lookup);
      if (bound && raw.trim() === "") blank.push(n);
      params.push(cleanParam(raw));
    }
    return { params, unbound, blank };
  }

  // Named path: the SAME placeholders `interpolate` would substitute, returned
  // in order. "Hi {{full_name}}, order {{ref_1}}" maps to ["Wong", "znt7001"].
  const params: string[] = [];
  const blank: number[] = [];
  const re = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(body)) !== null) {
    i++;
    const raw = lookup[m[1]];
    const value = raw == null ? "" : String(raw);
    if (value.trim() === "") blank.push(i);
    params.push(cleanParam(value));
  }
  return { params, unbound: [], blank };
}

/**
 * Template body parameters IN ORDER, for a contact.
 *
 * `bindings` is REQUIRED for a Meta-style positional body — without it every
 * {{n}} resolves to "-". Callers that can surface a problem should check
 * `templateBindingGaps` first; this returns the parameters only.
 */
export function extractParams(
  template: string,
  ctx: VarContext,
  bindings?: VarBinding[] | null
): string[] {
  return resolveSendParams(template, ctx, bindings).params;
}

/**
 * What the customer will actually read: the template body with its {{n}} slots
 * filled by the resolved parameters, in order.
 *
 * The inbox stores this as the message body, so a template send shows the real
 * sentence in the thread instead of the raw "{{2}}" skeleton.
 */
export function applyParams(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => {
    const v = params[Number(n) - 1];
    return v == null || v === "" ? m : v;
  });
}

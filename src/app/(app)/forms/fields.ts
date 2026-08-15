/**
 * The shape of a WhatsApp Form's questions, and the plain-language names for
 * them.
 *
 * Not a "use server" module: it exports constants and pure functions, so the
 * editor (client), the page (server) and the actions file all read the same
 * definitions instead of each inventing their own.
 *
 * `form.fields` is free-form jsonb — anything could be in there — so every
 * function here takes `unknown` and hands back a clean array.
 */

export interface FormField {
  /** the attribute the answer is saved onto, e.g. delivery_date_1 */
  key: string;
  /** the question the customer reads */
  label: string;
  type: FieldType;
}

export type FieldType = "text" | "number" | "date" | "select" | "email" | "phone";

/**
 * What each answer type is called in words, and what the customer actually
 * gets. The stored value stays lowercase (`date`, `select`) — the owner should
 * never be shown that.
 */
export const FIELD_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: "text", label: "Short answer", hint: "They type a line of text" },
  { value: "number", label: "Number", hint: "They type a number" },
  { value: "date", label: "Date", hint: "They pick a date" },
  { value: "select", label: "Pick from a list", hint: "They choose one option" },
  { value: "email", label: "Email address", hint: "They type an email" },
  { value: "phone", label: "Phone number", hint: "They type a phone number" },
];

const TYPE_SET = new Set<string>(FIELD_TYPES.map((t) => t.value));

export function fieldTypeLabel(type: string): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? "Short answer";
}

/** Turn a question into a stable attribute key: "Preferred date" → preferred_date. */
export function keyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Read `form.fields` out of the database. Rows missing a label or a key are
 * repaired from whichever one is present; an unrecognised type falls back to a
 * short answer rather than being dropped, so nothing silently disappears from
 * a form the owner already built.
 */
export function readFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const rawKey = typeof r.key === "string" ? r.key.trim() : "";
    const key = rawKey || keyFromLabel(label);
    if (!key && !label) continue;
    const type = typeof r.type === "string" ? r.type.toLowerCase() : "text";
    out.push({
      key: key || keyFromLabel(label),
      label: label || key,
      type: (TYPE_SET.has(type) ? type : "text") as FieldType,
    });
  }
  return out;
}

/**
 * Clean a set of questions on the way into the database: drop blank rows, fill
 * in missing keys, force keys unique (two questions writing to one attribute
 * means the second answer silently overwrites the first).
 */
export function normaliseFields(input: unknown): FormField[] {
  const rows = readFields(input);
  const seen = new Set<string>();
  const out: FormField[] = [];
  for (const f of rows) {
    const label = f.label.trim();
    let key = (f.key.trim() || keyFromLabel(label)).toLowerCase();
    if (!label && !key) continue;
    if (!key) key = `field_${out.length + 1}`;
    let unique = key;
    let n = 2;
    while (seen.has(unique)) unique = `${key}_${n++}`;
    seen.add(unique);
    out.push({ key: unique, label: label || unique, type: f.type });
  }
  return out;
}

/**
 * The "one question per line — key | label | type" shorthand the create box
 * accepts. Kept because it is how the existing forms were typed in; the detail
 * page has a proper row editor for everything after that.
 */
export function parseFieldLines(text: string): FormField[] {
  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [key, label, type] = l.split("|").map((s) => s.trim());
      return { key: key || label, label: label || key, type: (type || "text").toLowerCase() };
    });
  return normaliseFields(rows);
}

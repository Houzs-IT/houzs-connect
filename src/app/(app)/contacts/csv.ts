/**
 * CSV parsing and import bookkeeping for the Contacts importer.
 *
 * Deliberately dependency-free. package.json carries no CSV library, and the
 * two places this code runs are both places where a new dependency costs
 * something real: the browser (the parse happens there, so the file never has
 * to be uploaded) and a Cloudflare Worker bundle. What a CSV library buys over
 * the parser below is dialect guessing and streaming, neither of which an
 * address-book export needs.
 *
 * This module holds NO server logic on purpose. `actions.ts` is a `"use server"`
 * module, which may export only async functions — so the shared types, the
 * constants both sides need, and every pure helper live here instead, where the
 * client component and the server action can both import them.
 */

/**
 * The importer reads the whole file into memory in the browser and holds the
 * parsed rows there while you map the columns, so the ceiling is the tab, not
 * the server. 20,000 rows of a typical CRM export is a few MB of strings —
 * comfortable. The owner's real address book is ~4,170.
 */
export const MAX_ROWS = 20_000;

/**
 * Rows per server action call.
 *
 * Not a size problem — 200 rows is tens of KB against a 20 MB body limit — but
 * a memory and time one. The action runs in a Cloudflare Worker with a 128 MB
 * isolate, and each chunk holds its rows, the matching contacts read back from
 * Postgres, and the insert payload at once. Chunking also means a connection
 * that drops half way through a 4,000-row file has already committed the first
 * 3,800 rows rather than losing all of it.
 */
export const CHUNK_ROWS = 200;

/** The parse is a synchronous string walk, so a huge file would freeze the tab. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Rows shown with their normalised phone number before you commit. */
export const PREVIEW_ROWS = 5;

/**
 * A WhatsApp wa_id is a country code plus a subscriber number: 11-12 digits for
 * Malaysia, and E.164 caps every country at 15. Below 7 digits it is an
 * extension, an order number, or a stray column — not something a message can
 * be delivered to, and writing it would put a permanent junk row in the CRM
 * that a campaign then counts as an audience member.
 */
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

/** Skipped rows are counted exactly; only the rendered list is capped. */
export const MAX_SKIPS_SHOWN = 200;

/**
 * Where a CSV column goes. The three built-in targets are prefixed with "!"
 * because a `contact_field.key` cannot contain one — settings derives keys with
 * `replace(/[^a-z0-9]+/g, "_")` — so a custom field can never collide with
 * Name, Phone or Email.
 */
export const TARGET_IGNORE = "";
export const TARGET_NAME = "!name";
export const TARGET_PHONE = "!phone";
export const TARGET_EMAIL = "!email";

/** One parsed record, with the physical line it started on. */
export interface CsvRecord {
  /** 1-based line in the file, so it matches the row number in a text editor. */
  line: number;
  cells: string[];
}

/** A contact field the import can write into `contact.attributes`. */
export interface ImportField {
  key: string;
  name: string;
}

/** One row as it travels to the server. `phone` is the raw cell, not normalised. */
export interface ImportRowInput {
  line: number;
  phone: string;
  name: string;
  email: string;
  attributes: Record<string, string>;
}

export type SkipReason =
  | "no-phone"
  | "not-a-number"
  | "too-short"
  | "too-long"
  | "scientific"
  | "not-written";

/**
 * What became of one row. Every row in the file produces exactly one of these —
 * that is the whole point of the shape. A row that vanishes from an import is a
 * customer nobody knows is missing until a campaign under-delivers.
 */
export type RowOutcome =
  | { line: number; kind: "created"; phone: string }
  | { line: number; kind: "updated"; phone: string }
  | { line: number; kind: "duplicate"; phone: string; ofLine: number }
  | { line: number; kind: "skipped"; reason: SkipReason; message: string };

export interface ImportChunkInput {
  rows: ImportRowInput[];
  /** Applied to every contact the import touches. Empty means no tag. */
  tagName: string;
  /** Only the last chunk revalidates, so the page behind the panel repaints once. */
  final: boolean;
}

export type ImportChunkResult =
  | { ok: true; outcomes: RowOutcome[] }
  | { ok: false; error: string };

/** What `normalisePhone` made of a raw cell, for the pre-import preview. */
export interface PhonePreview {
  raw: string;
  phone: string;
  ok: boolean;
  message: string;
}

export type PhoneCheck =
  | { ok: true; phone: string }
  | { ok: false; reason: SkipReason; message: string };

/**
 * Whether a normalised number is worth writing, and if not, why in words.
 *
 * Takes the normalised value rather than producing it: normalisation is
 * `normalisePhone()` in actions.ts and must stay the single implementation, or
 * an import would file the same customer under a different key than the inbox
 * does. This is only the verdict, so the preview and the import can share it.
 */
export function checkPhone(raw: string, normalised: string): PhoneCheck {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "no-phone", message: "the phone column is empty" };
  }
  // "6.01111E+10" is what a spreadsheet does to a long number left as General.
  // Stripping non-digits from it yields a plausible-looking 8-digit number, so
  // this has to be caught before the digit rules, not after.
  if (/\d[.,]?\d*e[+-]?\d+/i.test(trimmed)) {
    return {
      ok: false,
      reason: "scientific",
      message: `"${trimmed}" is scientific notation — the spreadsheet mangled the number. Format that column as Text and export again.`,
    };
  }
  if (!normalised) {
    return { ok: false, reason: "not-a-number", message: `"${trimmed}" has no digits in it` };
  }
  if (normalised.length < MIN_PHONE_DIGITS) {
    return {
      ok: false,
      reason: "too-short",
      message: `"${trimmed}" is only ${normalised.length} digit${normalised.length === 1 ? "" : "s"} long`,
    };
  }
  if (normalised.length > MAX_PHONE_DIGITS) {
    return {
      ok: false,
      reason: "too-long",
      message: `"${trimmed}" is ${normalised.length} digits — longer than any phone number`,
    };
  }
  return { ok: true, phone: normalised };
}

const DELIMITERS = [",", ";", "\t", "|"];

/**
 * Which character separates the columns.
 *
 * Excel writes semicolons in any locale whose decimal separator is a comma, and
 * the failure mode without this is not an error — it is a single column called
 * `Name;Phone;Email` that maps to nothing and imports zero rows, with no clue
 * why. Counted over the header line only, and only outside quotes.
 */
export function sniffDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i += 1;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "\n" || ch === "\r") break;
    const n = counts.get(ch);
    if (n !== undefined) counts.set(ch, n + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/**
 * RFC 4180 with the concessions real exports need: a UTF-8 BOM, CRLF or LF or
 * bare CR line endings, quoted fields containing the delimiter or a newline,
 * `""` for a literal quote, and ragged rows.
 *
 * Blank lines are dropped rather than imported as empty rows — a trailing
 * newline is not a customer. Every surviving record keeps the physical line it
 * started on so the skipped-rows report can name a line the operator can find
 * in the spreadsheet.
 */
export function parseCsv(input: string, delimiter?: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? sniffDelimiter(text);

  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endRecord = () => {
    cells.push(field);
    field = "";
    // A row of nothing but empty cells is a blank line, not a contact.
    if (cells.some((c) => c.trim() !== "")) out.push({ line: recordLine, cells });
    cells = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      // A newline inside quotes belongs to the value, but still advances the
      // line counter — otherwise every later row reports the wrong line.
      if (ch === "\r") {
        field += "\n";
        line += 1;
        i += text[i + 1] === "\n" ? 2 : 1;
        continue;
      }
      if (ch === "\n") {
        field += "\n";
        line += 1;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    // A quote only opens a quoted field at the start of one; `a"b` is literal.
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === d) {
      cells.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      line += 1;
      recordLine = line;
      continue;
    }
    field += ch;
    i += 1;
  }

  // The last record when the file does not end in a newline.
  if (field !== "" || cells.length > 0) endRecord();
  return out;
}

const NAME_HEADERS = new Set([
  "name",
  "fullname",
  "contactname",
  "customername",
  "clientname",
  "displayname",
  "customer",
  "client",
]);
const PHONE_HEADERS = new Set([
  "phone",
  "phoneno",
  "phonenumber",
  "mobile",
  "mobileno",
  "mobilenumber",
  "hp",
  "hpno",
  "tel",
  "telno",
  "telephone",
  "contact",
  "contactno",
  "contactnumber",
  "number",
  "whatsapp",
  "whatsappno",
  "waid",
  "msisdn",
]);
const EMAIL_HEADERS = new Set(["email", "emailaddress", "mail", "eaddress"]);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * A first guess at where a column belongs, from its header.
 *
 * Exact matches win before substrings so that "Contact Name" lands on Name
 * rather than on Phone, which the `contact` entry in the phone list would
 * otherwise claim. Every guess is a `<select>` the operator can override — this
 * only saves the mapping step on a well-labelled export.
 */
export function guessTarget(header: string, fields: ImportField[]): string {
  const h = slug(header);
  if (!h) return TARGET_IGNORE;
  if (NAME_HEADERS.has(h)) return TARGET_NAME;
  if (PHONE_HEADERS.has(h)) return TARGET_PHONE;
  if (EMAIL_HEADERS.has(h)) return TARGET_EMAIL;
  const field = fields.find((f) => slug(f.key) === h || slug(f.name) === h);
  if (field) return field.key;
  if (h.includes("email") || h.includes("mail")) return TARGET_EMAIL;
  if (h.includes("phone") || h.includes("mobile") || h.includes("whatsapp") || h.includes("hp")) {
    return TARGET_PHONE;
  }
  if (h.includes("name")) return TARGET_NAME;
  return TARGET_IGNORE;
}

/** The first non-empty cell among the columns mapped to `target`. */
function pick(cells: string[], mapping: string[], target: string): string {
  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i] !== target) continue;
    const v = (cells[i] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/**
 * Parsed records plus a column mapping, as rows the server action takes.
 *
 * Where two columns carry the same target — "Mobile" and "Phone 2", which every
 * CRM export seems to have — the first non-empty one wins, rather than the last
 * column silently overwriting a good value with a blank.
 */
export function buildRows(records: CsvRecord[], mapping: string[]): ImportRowInput[] {
  const attrTargets = mapping
    .map((m, i) => ({ key: m, i }))
    .filter((m) => m.key !== TARGET_IGNORE && !m.key.startsWith("!"));

  return records.map((rec) => {
    const attributes: Record<string, string> = {};
    for (const t of attrTargets) {
      const v = (rec.cells[t.i] ?? "").trim();
      // Blank cells are left out entirely: the merge on the server is a spread,
      // so writing "" would erase a value the contact already has.
      if (v) attributes[t.key] = v.slice(0, 500);
    }
    return {
      line: rec.line,
      phone: pick(rec.cells, mapping, TARGET_PHONE).slice(0, 60),
      name: pick(rec.cells, mapping, TARGET_NAME).slice(0, 200),
      email: pick(rec.cells, mapping, TARGET_EMAIL).slice(0, 320),
      attributes,
    };
  });
}

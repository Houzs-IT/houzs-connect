// The definition of a campaign: which approved template goes out, which number
// it leaves from, where every {{n}} takes its value from, and who receives it.
//
// Pure module — imported by BOTH the client wizard and the server actions, so it
// must never import the database or anything Node-only.
//
// ── The variable mapping is NOT defined here ────────────────────────────────
// `VarBinding`, the built-in field list, gap detection and parameter resolution
// all live in src/lib/automation/vars.ts, and the saved per-template mapping
// lives in src/lib/whatsapp/templateBindings.ts. Both are owned elsewhere and
// both are consumed as-is: a second mapping mechanism on this page is exactly
// the "two incompatible variable syntaxes" problem that made the old composer
// unusable. What this file adds is only the campaign-shaped wrapper around them
// — which template, which audience, and the per-send override the wizard
// collects at step 4 (Seampify binds placeholders per send, so an override is
// the campaign's own data, not the template's).
//
// ── Where a campaign is stored, and why that is not where it belongs ────────
// `campaign` has columns for name, template_name, audience, schedule_at, status
// and stats. That is the whole table: there is nowhere to keep the message. So a
// campaign could be sent and then never re-opened, edited, duplicated or kept as
// a draft, because the body and the bindings were discarded the moment the send
// finished — which is exactly why Edit/Save/Duplicate did not exist on this
// page.
//
// This wants a dedicated `campaign.content jsonb` column. `src/db/schema.ts` is
// owned by another agent this session and migrations are out of scope here, so
// the spec rides inside the existing `audience` jsonb under a `spec` key, beside
// the legacy `kind`/`value` pair that older rows already carry. Lifting it out
// later is one statement: UPDATE campaign SET content = audience->'spec'.

import { asBindings, type VarBinding } from "@/lib/automation/vars";
import type { SampleContact } from "@/app/(app)/templates/types";

/** Bumped when the stored shape changes in a way old rows cannot satisfy. */
export const SPEC_VERSION = 1;

/** Seampify caps the campaign name at 150 characters and shows a counter. */
export const NAME_MAX = 150;

export type AudienceKind = "all" | "tag" | "attribute" | "ids";

export interface AudienceSpec {
  kind: AudienceKind;
  /** Tag name, when kind === "tag". */
  tag?: string;
  /** Contact attribute key, when kind === "attribute". */
  attrKey?: string;
  /** Required attribute value; empty means "has the attribute at all". */
  attrValue?: string;
  /** Hand-picked contact ids, when kind === "ids" (the Broadcast page). */
  contactIds?: string[];
}

export interface CampaignSpec {
  v: number;
  /** Name of the APPROVED template on the WABA. Empty on an unfinished draft. */
  templateName: string;
  /**
   * The language Meta lists the template under. Not decoration: three of the
   * live templates are en_GB, and a name/language mismatch is a 132001 from
   * Meta — the send is simply lost. The old code hard-coded "en".
   */
  templateLang: string;
  /**
   * The approved body as it read when the campaign was authored. Kept so the
   * wizard, the preview and the history can render without a Graph round-trip,
   * and so a template later edited on Meta's side is visibly different from what
   * this campaign was built against.
   */
  templateBody: string;
  /**
   * This campaign's per-send bindings, laid over the template's saved default by
   * `resolveSendBindings`. Empty means "use the template's mapping as-is".
   */
  bindings: VarBinding[];
  audience: AudienceSpec;
}

/**
 * Malaysia is UTC+8 all year — no daylight saving, ever — so a wall-clock
 * string can be turned into an instant with a fixed offset.
 *
 * This matters. `<input type="datetime-local">` yields "2026-09-01T18:00" with
 * no zone, and `new Date()` of that reads it as the RUNTIME's local time. The
 * runtime here is a Cloudflare Worker, whose clock is UTC, so a campaign
 * scheduled for 6pm was being stored as 6pm UTC — 2am the next day in the
 * office. Same class of bug as the eight-hour timestamp slip in lib/format.ts.
 */
export const MY_UTC_OFFSET = "+08:00";

/** "2026-09-01T18:00" (Malaysian wall clock) → an unambiguous instant. */
export function toInstant(datetimeLocal: string): string {
  return datetimeLocal ? `${datetimeLocal}:00${MY_UTC_OFFSET}` : "";
}

export function emptySpec(): CampaignSpec {
  return {
    v: SPEC_VERSION,
    templateName: "",
    templateLang: "en",
    templateBody: "",
    bindings: [],
    audience: { kind: "all" },
  };
}

// ── Persistence: the audience jsonb column ─────────────────────────────────

/** Legacy display shape older campaign rows carry, plus the spec we now add. */
interface StoredAudience {
  kind?: string;
  value?: string;
  spec?: unknown;
}

/** What goes into `campaign.audience`. `kind`/`value` stay for old readers. */
export function packAudience(spec: CampaignSpec): StoredAudience {
  const a = spec.audience;
  const value =
    a.kind === "tag"
      ? (a.tag ?? "")
      : a.kind === "attribute"
        ? a.attrValue
          ? `${a.attrKey} = ${a.attrValue}`
          : `has ${a.attrKey}`
        : a.kind === "ids"
          ? `${a.contactIds?.length ?? 0} selected`
          : "all";
  return { kind: a.kind, value, spec };
}

/**
 * Read a spec back out of the stored jsonb. Returns null for rows written before
 * this existed — the history shows those as a record only, because their message
 * was never recorded and inventing one would be a lie.
 */
export function unpackSpec(audience: unknown): CampaignSpec | null {
  const stored = (audience ?? {}) as StoredAudience;
  const raw = stored.spec as Partial<CampaignSpec> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.audience?.kind;
  return {
    v: typeof raw.v === "number" ? raw.v : SPEC_VERSION,
    templateName: typeof raw.templateName === "string" ? raw.templateName : "",
    templateLang: typeof raw.templateLang === "string" ? raw.templateLang : "en",
    templateBody: typeof raw.templateBody === "string" ? raw.templateBody : "",
    bindings: asBindings(raw.bindings),
    audience: {
      kind: kind === "tag" || kind === "attribute" || kind === "ids" ? kind : "all",
      tag: raw.audience?.tag,
      attrKey: raw.audience?.attrKey,
      attrValue: raw.audience?.attrValue,
      contactIds: Array.isArray(raw.audience?.contactIds)
        ? raw.audience!.contactIds!.filter((x): x is string => typeof x === "string")
        : undefined,
    },
  };
}

/** Who the broadcast goes to, in words, for the history table. */
export function audienceLabel(audience: unknown): string {
  const a = (audience ?? {}) as StoredAudience;
  if (a.kind === "tag" && a.value) return `Tagged "${a.value}"`;
  if (a.kind === "attribute" && a.value) return `Where ${a.value}`;
  if (a.kind === "ids") return a.value ? `${a.value} contacts` : "Selected contacts";
  return "Everyone in the address book";
}

// ── What the send wrote down ───────────────────────────────────────────────

/**
 * `campaign.stats`. Every field is something that was measured.
 *
 * `delivered`, `read` and `replied` are deliberately absent: WhatsApp reports
 * those against an individual message id, and nothing links a message row back
 * to the campaign that sent it, so there is no honest value to store. The
 * history prints a dash and says why.
 */
export interface CampaignStats {
  /** Everyone the audience matched, before exclusions. */
  total?: number;
  /** Messages Meta accepted. */
  sent?: number;
  /** Messages Meta refused (no message id came back). */
  failed?: number;
  skippedBlocked?: number;
  skippedOptedOut?: number;
  /** ISO timestamps — the campaign table has no columns for these. */
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Contact ids already ATTEMPTED, so a send that runs in chunks (see
   *  sendCampaignNow) never re-sends or skips anyone across requests. Internal
   *  progress state, not shown in the UI. */
  doneIds?: string[];
}

// ── Server action payloads ─────────────────────────────────────────────────
// These live here rather than beside the actions because a "use server" module
// may export nothing but async functions.

/** An approved template plus the mapping already saved for it. */
export interface CampaignTemplate {
  name: string;
  language: string;
  body: string;
  /** The template's saved default mapping, as the Templates page left it. */
  bindings: VarBinding[];
}

export interface CampaignInput {
  /** Absent when creating. */
  id?: string;
  name: string;
  /** Which WhatsApp number it leaves from (wizard step 2). */
  channelId: string;
  spec: CampaignSpec;
  /** datetime-local string, or empty/null for "send immediately". */
  scheduleAt?: string | null;
  /** Hold the send until a manager approves it (campaign.requires_approval). */
  requiresApproval?: boolean;
}

/** One row of the recipient table in step 3. */
export interface AudiencePreviewRow {
  id: string;
  name: string | null;
  phone: string;
  blocked: boolean;
  optedOut: boolean;
}

export interface AudienceCount {
  matched: number;
  blocked: number;
  optedOut: number;
  recipients: number;
  /** First few matched contacts, so the count is not the only evidence. */
  sample: AudiencePreviewRow[];
  /**
   * The first real RECIPIENT, so the wizard's live preview resolves against
   * actual data instead of guessing. Null when nobody is reachable.
   *
   * Shaped for the Templates page's own `VariableRows` / `MessagePreview`, which
   * this page reuses rather than growing a second, subtly different placeholder
   * editor. `sampleLookup` there reads built-ins off `name`/`phone` and takes
   * everything else from `attributes`, so the contact's email and source columns
   * are folded into that map — see `sampleFor` in actions.ts.
   */
  sampleContact: SampleContact | null;
}

/** What the review step shows before anything is sent. */
export interface SendPreview {
  matched: number;
  blocked: number;
  optedOut: number;
  recipients: number;
  templateName: string;
  /** The language the send will actually use, after binding resolution. */
  templateLang: string;
  /** Display name + number the broadcast goes out from. */
  channelLabel: string;
  sampleName: string | null;
  /** The exact resolved text one real recipient will receive. */
  sampleMessage: string | null;
  /** {{n}} slots with nothing behind them for that sample contact. */
  blankSlots: number[];
}

/**
 * Whether the save ended up held or immediate.
 *
 * Returned rather than assumed: only the server can say, because "is this time
 * in the future" is a clock question and the browser must not answer it during
 * render. A time that has already passed saves as a draft, and the operator is
 * told that instead of being shown a "Scheduled" label that is not true.
 */
export type SavedStatus = "draft" | "scheduled";

export interface SaveResult {
  ok: boolean;
  id?: string;
  status?: SavedStatus;
  error?: string;
}

export interface PrepareResult {
  ok: boolean;
  id?: string;
  status?: SavedStatus;
  preview?: SendPreview;
  error?: string;
}

export interface SendResult {
  ok: boolean;
  sent?: number;
  failed?: number;
  recipients?: number;
  /** Recipients still unsent after this chunk. The caller loops while > 0. */
  remaining?: number;
  error?: string;
}

export interface TestSendResult {
  ok: boolean;
  /** Who it went to, echoed back so the operator can check it was themselves. */
  to?: string;
  message?: string;
  error?: string;
}

// ── Validation, shared by the wizard and the server ────────────────────────

/**
 * Why this campaign may NOT be sent, or null when it may. Contact-independent
 * checks only; the gap check needs the merged bindings and runs on the server.
 *
 * The template rule is not a preference. A broadcast is business-initiated, so
 * for every recipient who has not messaged in the last 24 hours Meta refuses
 * free-form text outright. The old composer let an operator type a message,
 * leave the template box blank and press "Send broadcast"; that produced a run
 * of rejections charged against the WhatsApp number's quality rating. Checked in
 * the wizard so the button is dead, and again on the server so a bare POST
 * cannot get past it.
 */
export function sendBlocker(spec: CampaignSpec): string | null {
  if (!spec.templateName) {
    return "Pick an approved template first — WhatsApp refuses a broadcast that is not one.";
  }
  if (!spec.templateBody) {
    return "This template's text could not be read from WhatsApp. Refresh the template list.";
  }
  return null;
}

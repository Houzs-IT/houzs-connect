"use client";

// The pieces of the template editor that both the composer (new template) and
// the row editor (edit an existing one) need:
//
//   VariableRows      — one row per {{n}}, saying what it will be filled with
//   QuickReplyChips   — add/remove buttons as chips, never a textarea
//   MessagePreview    — the message as the customer will receive it
//   CharCount         — Meta's real limits, counted as you type
//
// All are controlled and effect-free: everything derives from props and state
// during render, so there is no setState-inside-useEffect anywhere.
//
// Interaction patterns follow the ERP: chips live INSIDE the bordered control
// next to the input (UserMultiSelect), each with an aria-labelled remove
// button; busy buttons change their label rather than showing a spinner.

import { useState } from "react";
import {
  isBound,
  positionalSlots,
  resolveBinding,
  type VarBinding,
} from "@/lib/automation/vars";
import { LIMITS } from "@/lib/whatsapp/templates";
import type { FieldOption, SampleContact } from "./types";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]";
const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";

/** Meta's own limit, counted live — the counters Seampify shows. */
export function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span
      className="text-[10.5px] tabular-nums"
      style={{ color: over ? "var(--color-danger)" : "var(--color-faint)" }}
    >
      {value.length}/{max}
    </span>
  );
}

/**
 * The lookup a preview resolves against — the sample contact, flattened.
 * Must stay in step with buildLookup() in lib/automation/vars.ts, which is what
 * an actual send uses; a preview that resolves differently from the send is
 * worse than no preview.
 */
export function sampleLookup(sample: SampleContact | null): Record<string, string> {
  if (!sample) return {};
  const full = (sample.name ?? "").trim();
  const space = full.indexOf(" ");
  const built: Record<string, string> = {
    full_name: full,
    first_name: space === -1 ? full : full.slice(0, space),
    last_name: space === -1 ? "" : full.slice(space + 1).trim(),
    phone: sample.phone,
  };
  // Only override an attribute when the column was actually supplied, so a
  // caller that carries these inside `attributes` is not blanked out by an
  // absent optional field.
  if (sample.email != null) built.email = sample.email;
  if (sample.source != null) built.source = sample.source;
  if (sample.sourceId != null) built.source_id = sample.sourceId;
  if (sample.sourceUrl != null) built.source_url = sample.sourceUrl;
  return { ...sample.attributes, ...built };
}

/** `builtin:full_name` / `field:ref_1` / `literal` / "" — the <select> value. */
function encodeBinding(b: VarBinding | undefined): string {
  if (!b) return "";
  if (b.source === "literal") return "literal";
  return `${b.source}:${b.key ?? ""}`;
}

function decodeBinding(index: number, raw: string, previous?: VarBinding): VarBinding | null {
  if (!raw) return null;
  const label = previous?.label;
  if (raw === "literal") {
    return { index, source: "literal", value: previous?.value ?? "", label };
  }
  const [source, key] = raw.split(":");
  if (source !== "field" && source !== "builtin") return null;
  return { index, source, key, label };
}

/** Human name for whatever a binding points at, for read-only summaries. */
export function describeBinding(b: VarBinding | undefined, fields: FieldOption[]): string {
  if (!isBound(b) || !b) return "not mapped";
  if (b.source === "literal") return b.value ? `"${b.value}"` : "fixed text (empty)";
  const f = fields.find((x) => x.key === b.key);
  return f ? `${f.name} (${f.key})` : (b.key ?? "unknown field");
}

/**
 * One row per {{n}}: a human label, the field it is bound to, and what that
 * resolves to for a real contact.
 *
 * Mirrors Seampify's campaign step 4, which shows `Placeholder {{1}}` with a
 * "Placeholder Name" text field and an "Attribute Placeholder" dropdown. The
 * difference is where it lives: Seampify asks every time you send, Connect
 * remembers the answer on the template and lets a send override it.
 */
export function VariableRows({
  body,
  bindings,
  fields,
  sample,
  examples,
  onBindingsChange,
  onExampleChange,
}: {
  body: string;
  bindings: VarBinding[];
  fields: FieldOption[];
  sample: SampleContact | null;
  /** Meta's required sample value per slot, when the caller needs them. */
  examples?: Record<number, string>;
  onBindingsChange: (next: VarBinding[]) => void;
  onExampleChange?: (index: number, value: string) => void;
}) {
  const slots = positionalSlots(body);
  const lookup = sampleLookup(sample);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));

  if (slots.length === 0) {
    return (
      <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        No variables in this body, so every customer receives exactly the same text.
        Use <span className="font-mono">{"{{1}}"}</span>, <span className="font-mono">{"{{2}}"}</span>{" "}
        where a name, reference number or date belongs.
      </p>
    );
  }

  function replaceSlot(index: number, next: VarBinding | null) {
    const rest = bindings.filter((b) => b.index !== index);
    if (next) rest.push(next);
    onBindingsChange(rest.sort((a, b) => a.index - b.index));
  }

  return (
    <div className="flex flex-col gap-2">
      {slots.map((n) => {
        const b = byIndex.get(n);
        const resolved = resolveBinding(b, lookup);
        const unmapped = !isBound(b);
        const blank = !unmapped && resolved.trim() === "";
        return (
          <div
            key={n}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
            style={unmapped ? { borderColor: "var(--color-danger)" } : undefined}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex-none rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink)]">
                {`{{${n}}}`}
              </span>
              <input
                value={b?.label ?? ""}
                onChange={(e) =>
                  replaceSlot(
                    n,
                    b
                      ? { ...b, label: e.target.value }
                      : { index: n, source: "field", key: "", label: e.target.value }
                  )
                }
                placeholder="what this slot is called, e.g. Reference no."
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent)]"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="flex-none text-[11px] text-[var(--color-faint)]">filled with</span>
              <select
                value={encodeBinding(b)}
                onChange={(e) => replaceSlot(n, decodeBinding(n, e.target.value, b))}
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">— choose a source —</option>
                <optgroup label="Every contact has these">
                  {fields
                    .filter((f) => f.builtin)
                    .map((f) => (
                      <option key={f.key} value={`builtin:${f.key}`}>
                        {f.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Contact fields">
                  {fields
                    .filter((f) => !f.builtin)
                    .map((f) => (
                      <option key={f.key} value={`field:${f.key}`}>
                        {f.name} ({f.key})
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Not from the contact">
                  <option value="literal">Fixed text — same for everyone</option>
                </optgroup>
              </select>
            </div>

            {b?.source === "literal" && (
              <input
                value={b.value ?? ""}
                onChange={(e) => replaceSlot(n, { ...b, value: e.target.value })}
                placeholder="the exact words to send"
                className={`mt-1.5 ${inputCls}`}
              />
            )}

            <p className="mt-1.5 text-[11px] leading-relaxed">
              {unmapped ? (
                <span className="text-[var(--color-danger)]">
                  Nothing chosen. Every customer would receive a dash here.
                </span>
              ) : blank ? (
                <span style={{ color: "var(--color-warning)" }}>
                  {sample
                    ? `${sample.label} has nothing in this field and would receive a dash. Contacts that do have it are fine.`
                    : "No sample contact to check this against yet."}
                </span>
              ) : (
                <span className="text-[var(--color-muted)]">
                  {sample ? `${sample.label} receives ` : "Sends "}
                  <span className="font-medium text-[var(--color-ink)]">{resolved}</span>
                </span>
              )}
            </p>

            {onExampleChange && (
              <div className="mt-1.5">
                <label className="mb-1 block text-[10.5px] text-[var(--color-faint)]">
                  Sample for Meta&apos;s reviewer — never sent to a customer, so do not use
                  real customer information
                </label>
                <input
                  value={examples?.[n] ?? ""}
                  onChange={(e) => onExampleChange(n, e.target.value)}
                  placeholder="e.g. Wong"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Quick replies as chips.
 *
 * This replaced a textarea whose placeholder read "Confirm Date / Amend Date" —
 * grey text that looks exactly like content already in the box. The owner read
 * it as two buttons already attached and asked whether the field ADDS or
 * REMOVES them. A chip is unambiguous: it is either on screen or it is not.
 */
export function QuickReplyChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const full = value.length >= LIMITS.buttonCount;
  const canAdd = draft.trim() !== "" && !full && !value.includes(draft.trim());

  function add() {
    const text = draft.trim().slice(0, LIMITS.button);
    if (!text || full || value.includes(text)) return;
    onChange([...value, text]);
    setDraft("");
  }

  return (
    <div>
      <div
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-[var(--color-surface-2)] px-2 py-1.5 transition-colors"
        style={{
          borderColor: focused ? "var(--color-accent)" : "var(--color-border)",
        }}
      >
        {value.map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-accent)]"
          >
            {b}
            <button
              type="button"
              aria-label={`Remove the ${b} button`}
              onClick={() => onChange(value.filter((x) => x !== b))}
              className="rounded-full px-0.5 leading-none hover:bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          value={draft}
          maxLength={LIMITS.button}
          disabled={full}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Adding a chip must not submit the whole template.
              e.preventDefault();
              add();
            }
          }}
          placeholder={
            full
              ? "Meta allows 3 buttons at most"
              : value.length === 0
                ? "Type a label and press Enter to add a button"
                : "Add another"
          }
          className="min-w-[140px] flex-1 bg-transparent py-0.5 text-[13px] outline-none placeholder:text-[var(--color-faint)] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="flex-none rounded-md border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          + Add
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
        {value.length === 0
          ? "No buttons yet — the message arrives as plain text with nothing to tap."
          : `${value.length} button${value.length === 1 ? "" : "s"} will be attached, in this order.`}{" "}
        Adding a chip ADDS a button; removing the chip removes it. Max{" "}
        {LIMITS.buttonCount}, {LIMITS.button} characters each. A customer tapping one
        sends its label back as their reply.
      </p>
    </div>
  );
}

/** *bold* the way WhatsApp renders it, so the preview is not a lie. */
function renderWhatsAppText(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
      <strong key={i} className="font-semibold">
        {part.slice(1, -1)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/**
 * The message as the customer's phone will show it: header, body with the
 * mapping applied, footer, then the buttons. This is the answer to
 * "1号、2号、3号、4号对接的是什么资料" — you read the finished sentence.
 */
export function MessagePreview({
  header,
  body,
  footer,
  buttons,
  bindings,
  sample,
}: {
  header?: string;
  body: string;
  footer?: string;
  buttons: string[];
  bindings: VarBinding[];
  sample: SampleContact | null;
}) {
  const lookup = sampleLookup(sample);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));
  const filled = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => {
    const b = byIndex.get(Number(n));
    if (!b) return m;
    const v = resolveBinding(b, lookup).replace(/\s+/g, " ").trim();
    return v === "" ? "-" : v;
  });

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-[var(--color-muted)]">Preview</span>
        <span className="text-[10.5px] text-[var(--color-faint)]">
          {sample ? `as ${sample.label} would receive it` : "no contacts to preview with"}
        </span>
      </div>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <div className="rounded-lg rounded-tl-none bg-[var(--color-surface)] p-2.5 shadow-card">
          {header?.trim() && (
            <p className="mb-1 break-words text-[12.5px] font-semibold text-[var(--color-ink)]">
              {header.trim()}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--color-ink)]">
            {renderWhatsAppText(filled || "—")}
          </p>
          {footer?.trim() && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-[var(--color-faint)]">
              {footer.trim()}
            </p>
          )}
        </div>
        {buttons.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            {buttons.map((b) => (
              <div
                key={b}
                className="rounded-lg bg-[var(--color-surface)] py-1.5 text-center text-[12px] font-medium text-[var(--color-accent)] shadow-card"
              >
                {b}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { inputCls, labelCls };

"use client";

// One template in the list: what it says, what fills its variables, and what
// can be done to it.
//
// Two things this fixes that the owner asked about directly:
//
//   "1号、2号、3号、4号对接的是什么资料?" — every {{n}} now names the field it
//   draws from, with the value a real contact would receive.
//
//   "为什么不能 edit?" — Meta only allows an edit while a template is APPROVED,
//   REJECTED or PAUSED. A template under review cannot be changed. The old UI
//   simply had no Edit button and never said why, so the answer looked like a
//   missing feature. Now the reason is on screen.

import { useState, useTransition } from "react";
import type { TemplateStatus } from "@/lib/whatsapp/templates";
import { LIMITS } from "@/lib/whatsapp/templates";
import { isBound, positionalSlots, type VarBinding } from "@/lib/automation/vars";
import { editTemplateAction, saveBindingAction } from "./actions";
import {
  CharCount,
  MessagePreview,
  QuickReplyChips,
  VariableRows,
  describeBinding,
  inputCls,
  labelCls,
  sampleLookup,
} from "./TemplateFields";
import type { FieldOption, SampleContact, TemplateRowData } from "./types";

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "var(--color-success)",
  PENDING: "var(--color-warning)",
  REJECTED: "var(--color-danger)",
  PAUSED: "var(--color-warning)",
  DISABLED: "var(--color-faint)",
};

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";

export function TemplateRow({
  template,
  fields,
  sample,
  children,
}: {
  template: TemplateRowData;
  fields: FieldOption[];
  sample: SampleContact | null;
  /** The Delete form — a server-action form the parent server component owns. */
  children?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"idle" | "mapping" | "editing">("idle");
  const [bindings, setBindings] = useState<VarBinding[]>(template.bindings);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const slots = positionalSlots(template.body);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));
  const unmapped = slots.filter((n) => !isBound(byIndex.get(n)));
  const lookup = sampleLookup(sample);

  const editable = template.editBlocked === null && !template.mediaHeader;

  function saveMapping() {
    setNote(null);
    start(async () => {
      const res = await saveBindingAction(template.name, template.language, bindings);
      setNote(
        res.ok
          ? { ok: true, text: "Mapping saved." }
          : { ok: false, text: res.error ?? "Could not save the mapping." }
      );
      if (res.ok) setMode("idle");
    });
  }

  return (
    <li className="border-b border-[var(--color-border)] px-4 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12.5px] font-medium text-[var(--color-ink)]">
              {template.name}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
              style={{
                background: `color-mix(in srgb, ${STATUS_COLOR[template.status] ?? "var(--color-muted)"} 12%, transparent)`,
                color: STATUS_COLOR[template.status] ?? "var(--color-muted)",
              }}
            >
              {template.status}
            </span>
            <span className="text-[11px] text-[var(--color-faint)]">
              {template.category} · {template.language}
            </span>
            {slots.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                style={
                  unmapped.length > 0
                    ? {
                        background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                        color: "var(--color-danger)",
                      }
                    : {
                        background: "color-mix(in srgb, var(--color-success) 12%, transparent)",
                        color: "var(--color-success)",
                      }
                }
              >
                {unmapped.length > 0
                  ? `${unmapped.length} of ${slots.length} variables not mapped`
                  : `${slots.length} variables mapped`}
              </span>
            )}
          </div>

          {template.header && (
            <p className="mt-1.5 break-words text-[12.5px] font-semibold text-[var(--color-ink)]">
              {template.header}
            </p>
          )}
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--color-muted)]">
            {template.body}
          </p>
          {template.footer && (
            <p className="mt-1.5 break-words text-[11px] text-[var(--color-faint)]">
              {template.footer}
            </p>
          )}
          {template.buttons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {template.buttons.map((b) => (
                <span
                  key={b}
                  className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                >
                  {b}
                </span>
              ))}
            </div>
          )}
          {template.status === "REJECTED" && template.rejectedReason && (
            <p className="mt-2 text-[12px] text-[var(--color-danger)]">
              Rejected: {template.rejectedReason}
            </p>
          )}
        </div>

        <div className="flex flex-none flex-col items-end gap-1.5">
          <div className="flex gap-1.5">
            {slots.length > 0 && (
              <button
                type="button"
                className={btnSecondary}
                onClick={() => setMode(mode === "mapping" ? "idle" : "mapping")}
              >
                {mode === "mapping" ? "Close" : "Variables"}
              </button>
            )}
            {editable && (
              <button
                type="button"
                className={btnSecondary}
                onClick={() => setMode(mode === "editing" ? "idle" : "editing")}
              >
                {mode === "editing" ? "Close" : "Edit"}
              </button>
            )}
            {children}
          </div>
        </div>
      </div>

      {/* Why Edit is absent — the question the owner actually asked. */}
      {!editable && (
        <p className="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-ink)]">Cannot be edited right now.</span>{" "}
          {template.mediaHeader
            ? "This template has an image, video or document header. Editing replaces every part of a template, and this editor cannot carry a media header through, so editing here would delete it. Change it in Meta's own Business Manager instead."
            : template.editBlocked}
        </p>
      )}

      {/* Read-only mapping summary, always visible when there are variables. */}
      {slots.length > 0 && mode !== "mapping" && mode !== "editing" && (
        <div className="mt-2 flex flex-col gap-1">
          {slots.map((n) => {
            const b = byIndex.get(n);
            const resolved = b ? resolvedFor(b, lookup) : "";
            return (
              <div key={n} className="flex flex-wrap items-baseline gap-1.5 text-[11.5px]">
                <span className="font-mono text-[var(--color-ink)]">{`{{${n}}}`}</span>
                {b?.label && <span className="text-[var(--color-muted)]">{b.label}</span>}
                <span className="text-[var(--color-faint)]">
                  {b ? describeBinding(b, fields) : "not mapped"}
                </span>
                {b ? (
                  <span
                    style={{
                      color: resolved ? "var(--color-muted)" : "var(--color-warning)",
                    }}
                  >
                    {sample
                      ? resolved
                        ? `${sample.label} receives "${resolved}"`
                        : `${sample.label} has nothing here`
                      : ""}
                  </span>
                ) : (
                  <span className="text-[var(--color-danger)]">
                    every customer would receive a dash
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {note && (
        <p
          className="mt-2 rounded-md px-3 py-2 text-[11.5px]"
          style={{
            border: `1px solid color-mix(in srgb, ${note.ok ? "var(--color-success)" : "var(--color-danger)"} 40%, transparent)`,
            background: `color-mix(in srgb, ${note.ok ? "var(--color-success)" : "var(--color-danger)"} 8%, transparent)`,
            color: note.ok ? "var(--color-success)" : "var(--color-danger)",
          }}
        >
          {note.text}
        </p>
      )}

      {mode === "mapping" && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="mb-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
            What each variable is filled with when an automation or campaign sends this
            template. A campaign can still override any of these for one send.
          </p>
          <VariableRows
            body={template.body}
            bindings={bindings}
            fields={fields}
            sample={sample}
            onBindingsChange={setBindings}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => {
                setBindings(template.bindings);
                setMode("idle");
              }}
            >
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={pending} onClick={saveMapping}>
              {pending ? "Saving…" : "Save mapping"}
            </button>
          </div>
        </div>
      )}

      {mode === "editing" && (
        <EditTemplate
          template={template}
          fields={fields}
          sample={sample}
          bindings={bindings}
          onBindingsChange={setBindings}
          onDone={(text) => {
            setNote({ ok: true, text });
            setMode("idle");
          }}
          onCancel={() => setMode("idle")}
        />
      )}
    </li>
  );
}

function resolvedFor(b: VarBinding, lookup: Record<string, string>): string {
  if (b.source === "literal") return (b.value ?? "").trim();
  return (lookup[b.key ?? ""] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The edit form. Meta REPLACES every component on an edit rather than merging,
 * so this always sends the complete body + header + footer + buttons — which is
 * why they are all pre-filled from what Meta currently holds, including the
 * parts nobody intends to change.
 */
function EditTemplate({
  template,
  fields,
  sample,
  bindings,
  onBindingsChange,
  onDone,
  onCancel,
}: {
  template: TemplateRowData;
  fields: FieldOption[];
  sample: SampleContact | null;
  bindings: VarBinding[];
  onBindingsChange: (next: VarBinding[]) => void;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const [header, setHeader] = useState(template.header);
  const [body, setBody] = useState(template.body);
  const [footer, setFooter] = useState(template.footer);
  const [buttons, setButtons] = useState<string[]>(template.buttons);
  const [exampleOverrides, setExampleOverrides] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const slots = positionalSlots(body);
  const lookup = sampleLookup(sample);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));

  function exampleFor(n: number): string {
    const override = exampleOverrides[n];
    if (override !== undefined) return override;
    const b = byIndex.get(n);
    if (!b) return "";
    if (b.source === "literal") return b.value ?? "";
    return (lookup[b.key ?? ""] ?? "").replace(/\s+/g, " ").trim();
  }

  const unmapped = slots.filter((n) => !isBound(byIndex.get(n)));
  const missingExamples = slots.filter((n) => exampleFor(n).trim() === "");
  const blocker =
    body.trim() === ""
      ? "The body cannot be empty."
      : unmapped.length > 0
        ? `Choose what fills ${unmapped.map((n) => `{{${n}}}`).join(", ")}.`
        : missingExamples.length > 0
          ? `Meta needs a sample value for ${missingExamples.map((n) => `{{${n}}}`).join(", ")}.`
          : null;

  function save() {
    setError(null);
    start(async () => {
      const res = await editTemplateAction({
        templateId: template.id,
        status: template.status as TemplateStatus,
        header: header.trim() || undefined,
        body,
        footer: footer.trim() || undefined,
        examples: slots.map((n) => exampleFor(n)),
        buttons,
        templateName: template.name,
        language: template.language,
        bindings,
      });
      if (res.ok) {
        onDone(
          template.status === "APPROVED"
            ? "Sent to Meta. An edited template goes back for review and returns to APPROVED unless the new copy fails it."
            : "Sent to Meta for review."
        );
      } else {
        setError(res.error ?? "Meta refused the edit.");
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="mb-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        <span className="font-medium text-[var(--color-ink)]">Editing {template.name}.</span>{" "}
        The name ({template.name}) and language ({template.language}) identify the template
        at Meta and cannot be changed — create a new template for that. Saving replaces the
        whole message, so everything below is sent even if you did not change it.
        {template.status === "APPROVED" &&
          " Meta allows an approved template 10 edits per 30 days and one per 24 hours."}
      </p>

      <div className="mb-1 flex items-center justify-between">
        <label className={labelCls}>Header (optional)</label>
        <CharCount value={header} max={LIMITS.header} />
      </div>
      <input
        value={header}
        maxLength={LIMITS.header}
        onChange={(e) => setHeader(e.target.value)}
        placeholder="e.g. Order Update from Houzs Century"
        className={`mb-3 ${inputCls}`}
      />

      <div className="mb-1 flex items-center justify-between">
        <label className={labelCls}>Body</label>
        <CharCount value={body} max={LIMITS.body} />
      </div>
      <textarea
        rows={8}
        value={body}
        maxLength={LIMITS.body}
        onChange={(e) => setBody(e.target.value)}
        className={`mb-3 font-mono text-[12px] ${inputCls}`}
      />

      <label className={labelCls}>What fills each variable</label>
      <div className="mb-3">
        <VariableRows
          body={body}
          bindings={bindings}
          fields={fields}
          sample={sample}
          examples={Object.fromEntries(slots.map((n) => [n, exampleFor(n)]))}
          onBindingsChange={onBindingsChange}
          onExampleChange={(index, value) =>
            setExampleOverrides((prev) => ({ ...prev, [index]: value }))
          }
        />
      </div>

      <label className={labelCls}>Quick reply buttons</label>
      <div className="mb-3">
        <QuickReplyChips value={buttons} onChange={setButtons} />
      </div>

      <div className="mb-1 flex items-center justify-between">
        <label className={labelCls}>Footer (optional)</label>
        <CharCount value={footer} max={LIMITS.footer} />
      </div>
      <input
        value={footer}
        maxLength={LIMITS.footer}
        onChange={(e) => setFooter(e.target.value)}
        placeholder="e.g. Reply to this message if you need immediate assistance."
        className={`mb-3 ${inputCls}`}
      />

      <div className="mb-3">
        <MessagePreview
          header={header}
          body={body}
          footer={footer}
          buttons={buttons}
          bindings={bindings}
          sample={sample}
        />
      </div>

      {blocker && (
        <p
          className="mb-2 rounded-md px-3 py-2 text-[11.5px] leading-relaxed"
          style={{
            border: "1px solid color-mix(in srgb, var(--color-warning) 40%, transparent)",
            background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
            color: "var(--color-warning)",
          }}
        >
          {blocker}
        </p>
      )}
      {error && (
        <p className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={pending || !!blocker} onClick={save}>
          {pending ? "Sending to Meta…" : "Save and resubmit"}
        </button>
      </div>
    </div>
  );
}

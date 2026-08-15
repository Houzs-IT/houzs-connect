"use client";

// Template composer — the front end for submitting a WhatsApp template to Meta
// for review, AND for saying what each of its variables will be filled with.
//
// The two belong on one screen. Meta numbers template variables positionally
// ({{1}}, {{2}}), and a number says nothing about where its value comes from;
// the moment to capture that is while the person who wrote the copy is looking
// at it. Before this, "{{2}}" was written here and resolved nowhere, so every
// automated send put a dash in the slot.

import { useState, useTransition } from "react";
import type { TemplateCategory } from "@/lib/whatsapp/templates";
import { LIMITS } from "@/lib/whatsapp/templates";
import { isBound, positionalSlots, type VarBinding } from "@/lib/automation/vars";
import { submitTemplateWithBinding } from "./actions";
import {
  CharCount,
  MessagePreview,
  QuickReplyChips,
  VariableRows,
  inputCls,
  labelCls,
  sampleLookup,
} from "./TemplateFields";
import type { FieldOption, SampleContact } from "./types";

export function TemplateComposer({
  fields,
  sample,
}: {
  fields: FieldOption[];
  sample: SampleContact | null;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [category, setCategory] = useState<TemplateCategory>("UTILITY");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<string[]>([]);
  const [bindings, setBindings] = useState<VarBinding[]>([]);
  const [exampleOverrides, setExampleOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const slots = positionalSlots(body);
  const lookup = sampleLookup(sample);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));

  /**
   * Meta's sample value for a slot. Defaults to what the sample contact would
   * actually receive, so the reviewer sees a realistic value without anyone
   * typing it twice — overridable, because Meta's own guidance is not to put
   * real customer information in front of a reviewer.
   *
   * Derived at render time from state, never written back by an effect.
   */
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
  const nameClean = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

  const blocker =
    body.trim() === ""
      ? "Write the message body first."
      : nameClean === ""
        ? "Give the template a name."
        : unmapped.length > 0
          ? `Choose what fills ${unmapped.map((n) => `{{${n}}}`).join(", ")}.`
          : missingExamples.length > 0
            ? `Meta needs a sample value for ${missingExamples.map((n) => `{{${n}}}`).join(", ")}.`
            : null;

  function submit() {
    setResult(null);
    start(async () => {
      const res = await submitTemplateWithBinding({
        name,
        language,
        category,
        header: header.trim() || undefined,
        body,
        footer: footer.trim() || undefined,
        examples: slots.map((n) => exampleFor(n)),
        buttons,
        bindings,
      });
      setResult(
        res.ok
          ? {
              ok: true,
              text: `Submitted as ${nameClean} — Meta says ${res.status ?? "PENDING"}. Review usually finishes within 24 hours.`,
            }
          : { ok: false, text: res.error ?? "Meta refused the template." }
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">New template</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
          Meta reviews every template, usually within 24 hours. You cannot message a
          customer outside the 24-hour reply window without one.
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className={labelCls}>Name</label>
          <CharCount value={name} max={LIMITS.name} />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIMITS.name}
          placeholder="e.g. hc_order_delivery_follow_up_1_order"
          className={`mb-1 ${inputCls}`}
        />
        <p className="mb-3 text-[11px] text-[var(--color-faint)]">
          {nameClean && nameClean !== name.trim()
            ? `Meta will store this as ${nameClean} — lowercase letters, digits and underscores only.`
            : "Lowercase letters, digits and underscores only. The name cannot be changed later."}
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className={inputCls}
            >
              <option value="UTILITY">Utility — order &amp; delivery updates</option>
              <option value="MARKETING">Marketing — promotions</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={inputCls}
            >
              <option value="en">English</option>
              <option value="en_GB">English (UK)</option>
              <option value="ms">Malay</option>
              <option value="zh_CN">Chinese (Simplified)</option>
            </select>
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
          Language is part of the template&apos;s identity at Meta and cannot be changed
          later. The same name in en and in en_GB are two separate templates.
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className={labelCls}>Header (optional)</label>
          <CharCount value={header} max={LIMITS.header} />
        </div>
        <input
          value={header}
          onChange={(e) => setHeader(e.target.value)}
          maxLength={LIMITS.header}
          placeholder="e.g. Order Update from Houzs Century"
          className={`mb-1 ${inputCls}`}
        />
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
          One bold line above the message, like a subject. Fixed text only — no
          variables, because Meta numbers header variables in a separate sequence
          from the body&apos;s.
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className={labelCls}>
            Body — {"{{1}}"}, {"{{2}}"} for variables, *stars* for bold
          </label>
          <CharCount value={body} max={LIMITS.body} />
        </div>
        <textarea
          rows={9}
          value={body}
          maxLength={LIMITS.body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Hi {{1}}, good news — your order with Houzs has been scheduled for delivery.\n\nReference No. : *{{2}}*\nDelivery Date: *{{3}}*`}
          className={`mb-3 font-mono text-[12px] ${inputCls}`}
        />

        <label className={labelCls}>
          What fills each variable
          {slots.length > 0 ? ` — ${slots.length} in this body` : ""}
        </label>
        <div className="mb-3">
          <VariableRows
            body={body}
            bindings={bindings}
            fields={fields}
            sample={sample}
            examples={Object.fromEntries(slots.map((n) => [n, exampleFor(n)]))}
            onBindingsChange={setBindings}
            onExampleChange={(index, value) =>
              setExampleOverrides((prev) => ({ ...prev, [index]: value }))
            }
          />
        </div>

        <label className={labelCls}>Quick reply buttons (optional)</label>
        <div className="mb-3">
          <QuickReplyChips value={buttons} onChange={setButtons} />
        </div>

        <div className="mb-1 flex items-center justify-between">
          <label className={labelCls}>Footer (optional)</label>
          <CharCount value={footer} max={LIMITS.footer} />
        </div>
        <input
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          maxLength={LIMITS.footer}
          placeholder="e.g. Reply to this message if you need immediate assistance."
          className={`mb-1 ${inputCls}`}
        />
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--color-faint)]">
          A small grey line at the bottom of the message, under the body and above
          the buttons. Same for every customer — no variables. Usually a company name
          or a one-line instruction.
        </p>

        {blocker && (
          <p className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--color-warning)]">
            {blocker}
          </p>
        )}
        {result && (
          <p
            className="mb-2 rounded-md px-3 py-2 text-[11.5px] leading-relaxed"
            style={{
              border: `1px solid color-mix(in srgb, ${result.ok ? "var(--color-success)" : "var(--color-danger)"} 40%, transparent)`,
              background: `color-mix(in srgb, ${result.ok ? "var(--color-success)" : "var(--color-danger)"} 8%, transparent)`,
              color: result.ok ? "var(--color-success)" : "var(--color-danger)",
            }}
          >
            {result.text}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !!blocker}
          className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Submitting to Meta…" : "Submit for Meta review"}
        </button>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <MessagePreview
          header={header}
          body={body}
          footer={footer}
          buttons={buttons}
          bindings={bindings}
          sample={sample}
        />
      </div>
    </div>
  );
}

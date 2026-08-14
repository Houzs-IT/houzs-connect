"use client";

// Template composer — the front end for submitting a WhatsApp template to Meta
// for review. Everything an operator needs to create and submit a template
// lives here; there is no step that requires opening Meta's own console.

import { useState } from "react";
import { submitTemplateForm } from "./actions";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]";
const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";

/** {{1}}, {{2}}, … in order of first appearance. */
function placeholders(body: string): number[] {
  const seen = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) seen.add(Number(m[1]));
  return [...seen].sort((a, b) => a - b);
}

export function TemplateComposer() {
  const [body, setBody] = useState("");
  const vars = placeholders(body);

  return (
    <form
      action={submitTemplateForm}
      className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">New template</h3>
      <p className="mb-3 text-[11px] text-[var(--color-muted)]">
        Meta reviews every template — usually within 24 hours. You cannot message a customer
        outside the 24-hour reply window without one.
      </p>

      <label className={labelCls}>Name</label>
      <input
        name="name"
        required
        placeholder="e.g. hc_order_delivery_follow_up_1_order"
        className={`mb-3 ${inputCls}`}
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Category</label>
          <select name="category" defaultValue="UTILITY" className={inputCls}>
            <option value="UTILITY">Utility — order &amp; delivery updates</option>
            <option value="MARKETING">Marketing — promotions</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Language</label>
          <select name="language" defaultValue="en" className={inputCls}>
            <option value="en">English</option>
            <option value="en_GB">English (UK)</option>
            <option value="ms">Malay</option>
            <option value="zh_CN">Chinese (Simplified)</option>
          </select>
        </div>
      </div>

      <label className={labelCls}>
        Body — use {"{{1}}"}, {"{{2}}"} for variables, *stars* for bold
      </label>
      <textarea
        name="body"
        required
        rows={9}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Hi {{1}} 👋 Good news! Your order with Houzs has been scheduled for delivery.\n\nReference No. : *{{2}}*\nDelivery Date: *{{3}}*`}
        className={`mb-1 font-mono text-[12px] ${inputCls}`}
      />
      <p className="mb-3 text-[11px] text-[var(--color-faint)]">
        {vars.length === 0
          ? "No variables — this template sends the same text to everyone."
          : `${vars.length} variable(s): ${vars.map((n) => `{{${n}}}`).join(", ")}`}
      </p>

      {vars.length > 0 && (
        <>
          <label className={labelCls}>
            Sample values — one per line, in order. Meta rejects the template without these.
          </label>
          <textarea
            name="examples"
            required
            rows={vars.length}
            placeholder={vars.map((n) => `sample for {{${n}}}`).join("\n")}
            className={`mb-3 ${inputCls}`}
          />
        </>
      )}

      <label className={labelCls}>Quick reply buttons — one per line, max 3 (optional)</label>
      <textarea
        name="buttons"
        rows={2}
        placeholder={"Confirm Date\nAmend Date"}
        className={`mb-3 ${inputCls}`}
      />

      <label className={labelCls}>Footer (optional)</label>
      <input name="footer" placeholder="e.g. Houzs Century Sdn Bhd" className={`mb-4 ${inputCls}`} />

      <button
        type="submit"
        className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        Submit for Meta review
      </button>
    </form>
  );
}

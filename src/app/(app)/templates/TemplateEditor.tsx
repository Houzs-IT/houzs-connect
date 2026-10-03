"use client";

// The template editor: copy on the left, where each {{n}} comes from in the
// middle, the customer's phone on the right. One screen for a new template and
// for editing one Meta allows to be edited.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { isBound, positionalSlots, resolveBinding, type VarBinding } from "@/lib/automation/vars";
import { fmt } from "@/lib/i18n/dict";
import { LIMITS, type TemplateCategory, type TemplateStatus } from "@/lib/whatsapp/templates";
import { editTemplateAction, submitTemplateWithBinding, templateCurl } from "./actions";
import { SlotSelect } from "./SlotSelect";
import { TemplateBubble } from "./TemplateBubble";
import { sampleLookup } from "./TemplateFields";
import type { FieldOption, SampleContact, TemplateRowData } from "./types";

const card = "rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]";
const input =
  "h-[38px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)] disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-muted)]";
const label = "mb-1.5 block text-[12px] font-semibold text-[var(--color-ink)]";
const btn2 =
  "flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:opacity-40";
const btn1 =
  "flex h-[34px] items-center rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 disabled:shadow-none";

const LANGS: [string, string][] = [
  ["en", "English (en)"],
  ["en_GB", "English (en_GB)"],
  ["ms", "Malay (ms)"],
  ["zh_CN", "Chinese (zh_CN)"],
];
const EMOJI = ["🙂", "😊", "👍", "🙏", "🎉", "✅", "📦", "🚚", "🛋️", "📅", "⏰", "💬"];

function Counter({ v, max }: { v: string; max: number }) {
  return (
    <span className={`text-[11.5px] tabular-nums ${v.length > max ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
      {v.length} / {max}
    </span>
  );
}

export function TemplateEditor({
  existing,
  fields,
  samples,
}: {
  /** The template being edited; null for a new one. */
  existing: TemplateRowData | null;
  fields: FieldOption[];
  samples: SampleContact[];
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.tf;
  const editing = !!existing;

  const [name, setName] = useState(existing?.name ?? "");
  const [language, setLanguage] = useState(existing?.language ?? "en");
  const [category, setCategory] = useState<TemplateCategory>((existing?.category as TemplateCategory) ?? "UTILITY");
  const [headerOn, setHeaderOn] = useState(!!existing?.header);
  const [header, setHeader] = useState(existing?.header ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [footer, setFooter] = useState(existing?.footer ?? "");
  const [buttons, setButtons] = useState<string[]>(existing?.buttons ?? []);
  const [bindings, setBindings] = useState<VarBinding[]>(existing?.bindings ?? []);
  const [examples, setExamples] = useState<Record<number, string>>({});
  const [sampleIdx, setSampleIdx] = useState(0);
  const [emoji, setEmoji] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);

  const sample = samples[sampleIdx] ?? null;
  const lookup = sampleLookup(sample);
  const slots = positionalSlots(body);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));
  const valueFor = (n: number) => {
    const b = byIndex.get(n);
    return b ? resolveBinding(b, lookup).replace(/\s+/g, " ").trim() : "";
  };
  const exampleFor = (n: number) => examples[n] ?? valueFor(n);

  const nameClean = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const unmapped = slots.filter((n) => !isBound(byIndex.get(n)));
  const noExample = slots.filter((n) => !exampleFor(n).trim());
  const list = (ns: number[]) => ns.map((n) => `{{${n}}}`).join(", ");
  const blocker = !body.trim()
    ? L.writeBody
    : !nameClean
      ? L.giveName
      : unmapped.length
        ? fmt(L.chooseFill, { slots: list(unmapped) })
        : noExample.length
          ? fmt(L.needExample, { slots: list(noExample) })
          : null;

  const payload = () => ({
    name,
    language,
    category,
    header: headerOn ? header.trim() || undefined : undefined,
    body,
    footer: footer.trim() || undefined,
    examples: slots.map((n) => exampleFor(n)),
    buttons: buttons.map((b) => b.trim()).filter(Boolean),
    bindings,
  });

  function setSlot(n: number, next: VarBinding | null) {
    const rest = bindings.filter((b) => b.index !== n);
    setBindings(next ? [...rest, next].sort((a, b) => a.index - b.index) : rest);
  }

  /** Wrap the selection in a WhatsApp marker, or insert text at the cursor. */
  function edit(before: string, after = "") {
    const el = area.current;
    const s = el?.selectionStart ?? body.length;
    const e = el?.selectionEnd ?? body.length;
    const next = body.slice(0, s) + before + body.slice(s, e) + after + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + before.length, e + before.length);
    });
  }
  const addVariable = () => edit(`{{${(slots.length ? Math.max(...slots) : 0) + 1}}}`);

  /** “Hi ___!” — a few words either side of the slot, so a row says where it sits. */
  const context = (n: number) => {
    const m = new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`).exec(body);
    if (!m) return "";
    const pre = body.slice(Math.max(0, m.index - 14), m.index).split("\n").pop() ?? "";
    const post = body.slice(m.index + m[0].length, m.index + m[0].length + 8).split("\n")[0];
    return `“${pre.trimStart()}___${post}${post.length >= 8 ? "…" : ""}”`;
  };

  function submit() {
    setNote(null);
    start(async () => {
      if (existing) {
        const res = await editTemplateAction({
          templateId: existing.id,
          status: existing.status as TemplateStatus,
          ...payload(),
          templateName: existing.name,
          language: existing.language,
        });
        if (!res.ok) return setNote({ ok: false, text: res.error ?? "Meta refused the edit." });
        setNote({ ok: true, text: L.resubmitted });
      } else {
        const res = await submitTemplateWithBinding(payload());
        if (!res.ok) return setNote({ ok: false, text: res.error ?? "Meta refused the template." });
        setNote({ ok: true, text: fmt(L.submitted, { name: nameClean, status: res.status ?? "PENDING" }) });
      }
      router.push("/templates");
      router.refresh();
    });
  }

  function copyCurl() {
    start(async () => {
      const res = await templateCurl(payload());
      if (!res.ok || !res.curl) return setNote({ ok: false, text: res.error ?? "Could not build the request." });
      try {
        await navigator.clipboard.writeText(res.curl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        setNote({ ok: false, text: res.curl });
      }
    });
  }

  const types: [string, string, string, string, boolean][] = [
    ["Aa", L.standard, L.standardHint, "blue", true],
    ["▥", L.carousel, L.carouselHint, "purple", false],
    ["☏", L.callPerm, L.callPermHint, "green", false],
    ["@", L.contactReq, L.contactReqHint, "pink", false],
  ];
  const allMapped = slots.length > 0 && unmapped.length === 0;
  const blocked = existing?.editBlocked || (existing?.mediaHeader ? L.mediaHeader : null);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Link
          href="/templates"
          aria-label={L.back}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{nameClean || L.newTemplate}</span>
            <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
              {existing ? (L.statusL[existing.status] ?? existing.status) : L.draftBadge}
            </span>
          </div>
          <div className="truncate text-[11.5px] text-[var(--color-faint)]">{editing ? L.editSub : L.newSub}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" className={btn2} disabled={pending || !body.trim() || !nameClean} onClick={copyCurl}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
            </svg>
            {copied ? L.copied : L.copyCurl}
          </button>
          <button type="button" className={btn1} disabled={pending || !!blocker || !!blocked} title={blocker ?? blocked ?? undefined} onClick={submit}>
            {pending ? L.submitting : editing ? L.resubmit : L.submit}
          </button>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-start">
          {/* ── Copy ── */}
          <section className={`${card} flex min-w-0 flex-1 flex-col gap-4 p-4 xl:max-w-[580px]`}>
            {(note || blocked) && (
              <p
                className={`whitespace-pre-wrap break-words rounded-[8px] px-3 py-2 text-[12.5px] ${
                  note?.ok ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                }`}
              >
                {note?.text ?? `${L.cantEdit} ${blocked}`}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
              <div>
                <span className={label}>{L.name}</span>
                <input value={name} disabled={editing} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder="delivery_date_confirm" className={input} />
              </div>
              <div>
                <span className={label}>{L.category}</span>
                <select value={category} disabled={editing} onChange={(e) => setCategory(e.target.value as TemplateCategory)} className={input}>
                  <option value="UTILITY">{L.utility}</option>
                  <option value="MARKETING">{L.marketing}</option>
                </select>
              </div>
              <div>
                <span className={label}>{L.language}</span>
                <select value={language} disabled={editing} onChange={(e) => setLanguage(e.target.value)} className={input}>
                  {LANGS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="-mt-2 text-[11.5px] text-[var(--color-faint)]">
              {editing ? L.nameFixed : fmt(L.nameHint, { name: nameClean || "—" })}
            </p>

            <div>
              <span className={label}>{L.type}</span>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {types.map(([icon, title, hint, tone, ok], i) => (
                  <div
                    key={title}
                    aria-disabled={!ok}
                    className={`relative rounded-[10px] border p-2.5 ${
                      i === 0
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40 shadow-[0_0_0_1px_var(--color-accent)]"
                        : "border-[var(--color-border)] opacity-70"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] text-[11px] font-bold"
                        style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                      >
                        {icon}
                      </span>
                      <span className="text-[12.5px] font-semibold leading-tight text-[var(--color-ink)]">{title}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-faint)]">{hint}</p>
                    {!ok && (
                      <span className="mt-1.5 inline-block rounded-full bg-[var(--color-surface-2)] px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
                        {L.proposal}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className={label}>{L.header}</span>
              <div className="mb-2 flex gap-2">
                {([
                  [L.hNone, !headerOn, () => setHeaderOn(false), true],
                  [L.hText, headerOn, () => setHeaderOn(true), true],
                  [L.hImage, false, () => {}, false],
                  [L.hDocument, false, () => {}, false],
                ] as [string, boolean, () => void, boolean][]).map(([l, on, fn, ok]) => (
                  <button
                    key={l}
                    type="button"
                    disabled={!ok}
                    title={ok ? undefined : L.mediaSoon}
                    onClick={fn}
                    className={`h-[32px] rounded-[8px] border px-3 text-[12.5px] font-semibold disabled:opacity-50 ${
                      on ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-ink)]"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {headerOn && (
                <div className="flex h-[38px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 focus-within:border-[var(--color-accent)]">
                  <input value={header} maxLength={LIMITS.header} onChange={(e) => setHeader(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
                  <Counter v={header} max={LIMITS.header} />
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className={`${label} mb-0`}>{L.body}</span>
                <Counter v={body} max={LIMITS.body} />
              </div>
              <div className="rounded-[10px] border border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-ring)]">
                <div className="relative flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                  {[
                    ["B", "*", "font-bold"],
                    ["I", "_", "italic"],
                    ["S", "~", "line-through"],
                  ].map(([l, m, cls]) => (
                    <button key={l} type="button" onClick={() => edit(m, m)} className={`grid h-7 w-7 place-items-center rounded-[6px] text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-surface)] ${cls}`}>
                      {l}
                    </button>
                  ))}
                  <button type="button" onClick={() => setEmoji((v) => !v)} className="grid h-7 w-7 place-items-center rounded-[6px] text-[14px] text-[var(--color-muted)] hover:bg-[var(--color-surface)]">
                    ☺
                  </button>
                  {emoji && (
                    <div className="absolute left-2 top-10 z-20 grid grid-cols-6 gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)]">
                      {EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            edit(e);
                            setEmoji(false);
                          }}
                          className="grid h-7 w-7 place-items-center rounded-[6px] text-[15px] hover:bg-[var(--color-surface-2)]"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addVariable}
                    className="ml-auto flex h-7 items-center gap-1 rounded-[6px] bg-[var(--color-pastel-purple)] px-2 text-[12px] font-semibold text-[var(--color-pastel-purple-ink)]"
                  >
                    + {L.variable}
                  </button>
                </div>
                <textarea
                  ref={area}
                  rows={7}
                  value={body}
                  maxLength={LIMITS.body}
                  onChange={(e) => setBody(e.target.value)}
                  className="block w-full resize-y rounded-b-[10px] bg-transparent px-3 py-2.5 text-[13px] leading-[1.7] text-[var(--color-ink)] outline-none"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className={`${label} mb-0`}>{L.footer}</span>
                <Counter v={footer} max={LIMITS.footer} />
              </div>
              <input value={footer} maxLength={LIMITS.footer} onChange={(e) => setFooter(e.target.value)} className={input} />
            </div>

            <div>
              <span className={label}>{L.buttons}</span>
              <div className="flex flex-col gap-2">
                {buttons.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select disabled className={`${input} w-[130px] shrink-0`}>
                      <option>{L.quickReply}</option>
                    </select>
                    <input
                      value={b}
                      maxLength={LIMITS.button}
                      onChange={(e) => setButtons((bs) => bs.map((x, j) => (j === i ? e.target.value : x)))}
                      className={input}
                    />
                    <button
                      type="button"
                      aria-label={L.remove}
                      onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-[16px] text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {buttons.length < LIMITS.buttonCount && (
                <button type="button" onClick={() => setButtons((bs) => [...bs, ""])} className="mt-2 text-[12.5px] font-semibold text-[var(--color-accent)]">
                  + {L.addButton}
                </button>
              )}
            </div>
          </section>

          {/* ── Where each variable comes from ── */}
          <section className={`${card} flex w-full shrink-0 flex-col gap-3 p-4 xl:w-[390px]`}>
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">{L.whereFrom}</h2>
              <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">{L.whereHint}</p>
            </div>
            {slots.length === 0 && <p className="text-[12.5px] text-[var(--color-faint)]">{L.noVarsHint}</p>}
            {slots.map((n) => (
              <div key={n} className="rounded-[10px] border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-[6px] bg-[var(--color-pastel-purple)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-pastel-purple-ink)]">{`{{${n}}}`}</span>
                  <span className="truncate text-[12px] text-[var(--color-muted)]">{context(n)}</span>
                </div>
                <SlotSelect index={n} binding={byIndex.get(n)} fields={fields} onChange={(next) => setSlot(n, next)} />
                <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--color-faint)]">
                  {L.sampleL} :
                  <input
                    value={exampleFor(n)}
                    onChange={(e) => setExamples((x) => ({ ...x, [n]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-[6px] bg-transparent px-1 py-0.5 font-semibold text-[var(--color-ink)] outline-none focus:bg-[var(--color-surface-2)]"
                  />
                </div>
              </div>
            ))}
            {slots.length > 0 && (
              <div
                className={`flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] font-semibold ${
                  allMapped ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                }`}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] text-white ${allMapped ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"}`}>
                  {allMapped ? "✓" : "!"}
                </span>
                {allMapped ? fmt(L.allMapped, { n: slots.length }) : fmt(L.someMissing, { n: unmapped.length })}
              </div>
            )}
          </section>

          {/* ── Phone ── */}
          <aside className="flex w-full shrink-0 flex-col xl:sticky xl:top-4 xl:w-[340px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.preview}</span>
              {samples.length > 0 && (
                <label className="flex items-center gap-1 text-[12px] text-[var(--color-faint)]">
                  {L.asL}
                  <select
                    value={sampleIdx}
                    onChange={(e) => setSampleIdx(Number(e.target.value))}
                    className="bg-transparent text-[12px] font-semibold text-[var(--color-ink)] outline-none"
                  >
                    {samples.map((s, i) => (
                      <option key={`${s.phone}-${i}`} value={i}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="flex h-[640px] flex-col overflow-hidden rounded-[30px] border-[8px] border-[#0b1020] bg-[#e9e2d6] shadow-[var(--shadow-modal)]">
              <div className="flex items-center gap-2.5 bg-[#1e6f80] px-3 py-2.5 text-white">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-hc-mark.png" alt="" className="h-4 w-4 object-contain" />
                </span>
                <span className="text-[12.5px] font-semibold">Houzs Century</span>
              </div>
              <div className="scroll-thin flex-1 overflow-y-auto p-2.5">
                {body.trim() ? (
                  <div className="max-w-[92%]">
                    <TemplateBubble
                      header={headerOn ? header : ""}
                      body={body}
                      footer={footer}
                      buttons={buttons.map((b) => b.trim()).filter(Boolean)}
                      time="10:04"
                      fill={(n) => valueFor(n) || null}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{L.utilNote}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

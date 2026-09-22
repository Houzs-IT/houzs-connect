"use client";

// The campaign wizard — the six steps Seampify walks an operator through
// (docs/seampify-spec.md §2), because the owner's instruction was that the
// Campaigns page must line up with how Templates work and must explain itself.
//
// What it replaced, and why:
//
//   • "Template name (optional)" was a free-text box. An operator was expected
//     to type an approved template's exact name from memory, and a typo meant a
//     run of silent rejections. Step 4 is now a picker over the account's real
//     APPROVED templates.
//   • The message box offered NAMED merge chips ({{full_name}}, {{ref_1}}) while
//     a Meta template body uses POSITIONAL {{1}}, {{2}}. Those two cannot both be
//     right. Step 4 binds each {{n}} to a field using the SAME `VariableRows`
//     and `MessagePreview` the Templates page uses, so the two pages behave
//     identically and there is only one mapping mechanism in the product.
//   • The footnote said "DEMO sends via the stubbed transport" on a system where
//     WHATSAPP_MODE=LIVE. Every step now states what will really happen, to how
//     many people, from which number.
//   • One unguarded "Send broadcast" button could message the whole address
//     book. Sending now needs a review and a two-click confirm, with a test send
//     available first.

import { useEffect, useState } from "react";
import Link from "next/link";
import { templateBindingGaps, type VarBinding } from "@/lib/automation/vars";
import { MessagePreview, VariableRows } from "@/app/(app)/templates/TemplateFields";
import type { FieldOption } from "@/app/(app)/templates/types";
import {
  countAudience,
  listCampaignTemplates,
  prepareSend,
  saveCampaign,
  sendCampaignNow,
  sendTestMessage,
} from "./actions";
import {
  NAME_MAX,
  emptySpec,
  sendBlocker,
  toInstant,
  type AudienceCount,
  type AudienceSpec,
  type CampaignSpec,
  type CampaignTemplate,
  type SavedStatus,
  type SendPreview,
} from "./spec";

interface ChannelOption {
  id: string;
  displayName: string;
  phone: string;
  isDefault: boolean;
}

interface TagOpt {
  name: string;
  color: string;
  count: number;
}

export interface CampaignDraft {
  id: string;
  name: string;
  channelId: string;
  spec: CampaignSpec;
  /** Pre-formatted for <input type="datetime-local">. */
  scheduleAt: string;
}

const STEPS = ["Name", "Sender", "Contacts", "Template", "Test send", "Review"] as const;

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]";
const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";
const primaryBtn =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white disabled:opacity-40";
const secondaryBtn =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40";

/** Seampify shows these beside the name box; the advice is genuinely useful. */
const DOS = [
  "Keep the name under 50 characters so it fits the history table.",
  "Say what it is and when — “Sept balance reminder”, not “Campaign 3”.",
  "One campaign per template, so the figures mean something.",
];
const DONTS = [
  "Do not send the same offer twice in a week — Meta scores that against the number.",
  "Do not use a MARKETING template for a delivery update; use UTILITY.",
  "Do not skip the test send.",
];

export function CampaignComposer({
  channels,
  tags,
  fields,
  attributeFields,
  templates: initialTemplates,
  templatesConfigured,
  live,
  initial,
}: {
  channels: ChannelOption[];
  tags: TagOpt[];
  /** Built-ins + this company's contact fields, for the placeholder dropdowns. */
  fields: FieldOption[];
  /** Just the company's own contact fields, for the "by attribute" audience. */
  attributeFields: FieldOption[];
  templates: CampaignTemplate[];
  templatesConfigured: boolean;
  live: boolean;
  initial: CampaignDraft | null;
}) {
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [channelId, setChannelId] = useState(
    initial?.channelId ?? channels.find((c) => c.isDefault)?.id ?? channels[0]?.id ?? ""
  );
  const [spec, setSpec] = useState<CampaignSpec>(initial?.spec ?? emptySpec());
  const [scheduleAt, setScheduleAt] = useState(initial?.scheduleAt ?? "");
  const [templates, setTemplates] = useState(initialTemplates);
  const [templateQuery, setTemplateQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Test send (step 5)
  const [testPhone, setTestPhone] = useState("");
  const [testArmed, setTestArmed] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Review (step 6)
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [sendArmed, setSendArmed] = useState(false);
  const [savedStatus, setSavedStatus] = useState<SavedStatus | null>(null);

  // ── Live recipient count ────────────────────────────────────────────────
  // Keyed on the serialised audience so the effect body needs no object in its
  // dependency list, and so "is this figure current?" is derived during render
  // rather than written by a setState inside the effect.
  const audKey = JSON.stringify(spec.audience);
  const [counted, setCounted] = useState<{ key: string; data: AudienceCount } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const aud = JSON.parse(audKey) as AudienceSpec;
    // Typing an attribute value would otherwise fire this on every keystroke.
    const timer = setTimeout(() => {
      void countAudience(aud).then((data) => {
        if (!cancelled) setCounted({ key: audKey, data });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audKey]);
  const counts = counted?.key === audKey ? counted.data : null;
  const sample = counts?.sampleContact ?? null;

  const chosen = templates.find((t) => t.name === spec.templateName) ?? null;
  const gaps = spec.templateBody ? templateBindingGaps(spec.templateBody, spec.bindings) : [];

  // Whether a time has been TYPED — a label question, answerable during render.
  // Whether that time is still in the FUTURE is a clock question, and a
  // component must not ask the clock while rendering (it would answer
  // differently on each re-render). The server decides and says so in
  // `savedStatus`; until then the wizard only claims a time was entered.
  const scheduleEntered = !!scheduleAt.trim();
  const heldForLater = savedStatus === "scheduled";

  function patchSpec(p: Partial<CampaignSpec>) {
    setSpec((s) => ({ ...s, ...p }));
    // Any edit invalidates a review that was already run.
    setPreview(null);
    setSendArmed(false);
    setSavedStatus(null);
  }

  function setAudience(p: Partial<AudienceSpec>) {
    patchSpec({ audience: { ...spec.audience, ...p } });
  }

  function chooseTemplate(t: CampaignTemplate) {
    // Seed the per-send bindings from whatever the Templates page already saved
    // for this template, so a mapped template arrives ready to send instead of
    // asking for the same four dropdowns again.
    patchSpec({
      templateName: t.name,
      templateLang: t.language,
      templateBody: t.body,
      bindings: t.bindings,
    });
  }

  async function refreshTemplates() {
    setRefreshing(true);
    try {
      setTemplates(await listCampaignTemplates());
    } finally {
      setRefreshing(false);
    }
  }

  function currentInput() {
    return {
      id: campaignId ?? undefined,
      name,
      channelId,
      spec,
      scheduleAt: toInstant(scheduleAt),
    };
  }

  async function onSaveDraft() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await saveCampaign(currentInput());
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not save.");
    if (res.id) setCampaignId(res.id);
    setSavedStatus(res.status ?? null);
    setNotice(
      res.status === "scheduled"
        ? "Scheduled. Nothing has been sent."
        : scheduleEntered
          ? "Saved as a draft — the time you picked has already passed, so it was not scheduled."
          : "Draft saved. Nothing has been sent."
    );
  }

  async function onReview() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setSendArmed(false);
    const res = await prepareSend(currentInput());
    setBusy(false);
    if (res.id) setCampaignId(res.id);
    setSavedStatus(res.status ?? null);
    setPreview(res.preview ?? null);
    if (!res.ok) setError(res.error ?? "Could not prepare this send.");
  }

  async function onTestSend() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    const res = await sendTestMessage({ spec, channelId, phone: testPhone });
    setBusy(false);
    setTestArmed(false);
    if (!res.ok) return setError(res.error ?? "The test send failed.");
    setTestResult(`Sent to ${res.to}.`);
  }

  async function onSendForReal() {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    // The send runs in chunks (see sendCampaignNow) so one request never runs the
    // Worker out of budget mid-broadcast; loop until nothing remains.
    let res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    while (res.ok && (res.remaining ?? 0) > 0) {
      res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    }
    setBusy(false);
    setSendArmed(false);
    if (!res.ok) return setError(res.error ?? "The send failed.");
    setNotice(
      `Sent to ${res.sent} of ${res.recipients} recipients${
        res.failed ? `, ${res.failed} refused by WhatsApp` : ""
      }.`
    );
    setPreview(null);
    setCampaignId(null);
    setSavedStatus(null);
    setStep(0);
    setName("");
    setSpec(emptySpec());
    setScheduleAt("");
  }

  // ── Step gating ─────────────────────────────────────────────────────────
  const stepBlocked: (string | null)[] = [
    name.trim() ? null : "Give the campaign a name.",
    channelId ? null : "Select a channel.",
    // While the count is in flight the answer is unknown, not zero — saying
    // "reaches nobody" there would be the same kind of confident wrong number
    // this whole change is about.
    !counts
      ? "Counting who this reaches…"
      : counts.recipients > 0
        ? null
        : "This audience reaches nobody.",
    sendBlocker(spec) ??
      (gaps.length > 0
        ? `${gaps.map((n) => `{{${n}}}`).join(", ")} still ${gaps.length === 1 ? "has" : "have"} no value.`
        : null),
    null, // the test send is optional, but strongly advised
    null,
  ];
  const blockedHere = stepBlocked[step];

  return (
    <div className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {/* Step strip */}
      <ol className="mb-4 flex flex-wrap gap-1">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                i === step
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              }`}
            >
              <span className="font-mono">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      {/* Only while this really is that campaign — a completed send clears
          `campaignId`, and the banner must not keep claiming otherwise. */}
      {initial && campaignId === initial.id && (
        <p className="mb-3 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
          Editing “{initial.name}”.{" "}
          <Link href="/campaigns" className="text-[var(--color-accent)] underline">
            Start a new one instead
          </Link>
        </p>
      )}

      {/* ── 1. Name ── */}
      {step === 0 && (
        <div>
          <label className={labelCls} htmlFor="campaign-name">
            Campaign name
          </label>
          <input
            id="campaign-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sept balance reminder"
            className={inputCls}
          />
          <div className="mb-3 mt-1 text-right text-[10px] tabular-nums text-[var(--color-faint)]">
            {name.length}/{NAME_MAX}
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[var(--color-success-soft)] p-2.5">
              <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-success)]">Do</h4>
              <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
                {DOS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[var(--color-danger-soft)] p-2.5">
              <h4 className="mb-1 text-[11px] font-semibold text-[var(--color-danger)]">Do not</h4>
              <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
                {DONTS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mb-2 text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            {showAdvanced ? "▾" : "▸"} Advanced configuration
          </button>
          {showAdvanced && (
            <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
              <label className={labelCls} htmlFor="campaign-schedule">
                Send at
              </label>
              <input
                id="campaign-schedule"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => {
                  setScheduleAt(e.target.value);
                  setSavedStatus(null);
                  setPreview(null);
                  setSendArmed(false);
                }}
                className={inputCls}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                {scheduleEntered
                  ? "A time in the future holds this as Scheduled. Nothing on this Worker dispatches it on a timer — once it is due it appears at the top of this page for someone to send. A time that has already passed simply saves a draft."
                  : "Leave this empty to send immediately, once you have reviewed it."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 2. Sender ── */}
      {step === 1 && (
        <div>
          <label className={labelCls}>Which WhatsApp number does this go out from?</label>
          {channels.length === 0 && (
            <p className="text-[12px] text-[var(--color-danger)]">
              No WhatsApp channel is configured for this company, so nothing can be sent.
            </p>
          )}
          <div className="grid gap-2">
            {channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setChannelId(ch.id)}
                aria-pressed={channelId === ch.id}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  channelId === ch.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <div className="text-[13px] font-medium text-[var(--color-ink)]">
                  {ch.displayName}
                </div>
                <div className="font-mono text-[11px] text-[var(--color-muted)]">{ch.phone}</div>
                {ch.isDefault && (
                  <div className="mt-0.5 text-[10px] text-[var(--color-faint)]">Default number</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Contacts ── */}
      {step === 2 && (
        <div>
          <label className={labelCls}>Who receives it</label>
          <div className="mb-2 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5">
            {(["all", "tag", "attribute"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setAudience({ kind: k })}
                aria-pressed={spec.audience.kind === k}
                className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  spec.audience.kind === k
                    ? "bg-[var(--color-surface)] text-[var(--color-accent)] shadow-card"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {k === "all" ? "All" : k === "tag" ? "By tag" : "By attribute"}
              </button>
            ))}
          </div>

          {spec.audience.kind === "tag" && (
            // With no tags configured this select has nothing to choose between,
            // so it says so rather than sitting there looking like a live picker.
            <select
              aria-label="Tag"
              value={spec.audience.tag ?? ""}
              onChange={(e) => setAudience({ tag: e.target.value })}
              disabled={tags.length === 0}
              title={
                tags.length === 0
                  ? "No tags exist yet — create them under Settings, then tag some contacts."
                  : undefined
              }
              className={`mb-3 ${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <option value="">{tags.length === 0 ? "No tags yet" : "Choose a tag…"}</option>
              {tags.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} ({t.count} reachable)
                </option>
              ))}
            </select>
          )}

          {spec.audience.kind === "attribute" && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <select
                aria-label="Attribute"
                value={spec.audience.attrKey ?? ""}
                onChange={(e) => setAudience({ attrKey: e.target.value })}
                disabled={attributeFields.length === 0}
                className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <option value="">
                  {attributeFields.length === 0 ? "No contact fields yet" : "Choose an attribute…"}
                </option>
                {attributeFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name} ({f.key})
                  </option>
                ))}
              </select>
              <input
                aria-label="Attribute value"
                value={spec.audience.attrValue ?? ""}
                onChange={(e) => setAudience({ attrValue: e.target.value })}
                placeholder="equals… (blank = any value)"
                className={inputCls}
              />
            </div>
          )}

          <div className="mb-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[12px]">
            {!counts && <span className="text-[var(--color-faint)]">Counting…</span>}
            {counts && (
              <>
                <div className="text-[var(--color-ink)]">
                  <span className="font-mono text-[15px] font-semibold">{counts.recipients}</span>{" "}
                  will receive this
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
                  {counts.matched} matched
                  {counts.blocked > 0 && ` · ${counts.blocked} blocked`}
                  {counts.optedOut > 0 && ` · ${counts.optedOut} switched marketing off`}
                  {counts.blocked + counts.optedOut > 0 && " — those are not sent to."}
                </div>
              </>
            )}
          </div>

          {counts && counts.sample.length > 0 && (
            <div className="mb-2 overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full min-w-[380px] text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                    <th className="px-2 py-1.5 font-medium">Phone</th>
                    <th className="px-2 py-1.5 font-medium">Name</th>
                    <th className="px-2 py-1.5 font-medium">Receives</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.sample.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-2 py-1.5 font-mono text-[var(--color-muted)]">{r.phone}</td>
                      <td className="px-2 py-1.5 text-[var(--color-ink)]">{r.name ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        {r.blocked ? (
                          <span className="text-[var(--color-danger)]">No — blocked</span>
                        ) : r.optedOut ? (
                          <span style={{ color: "var(--color-warning)" }}>No — opted out</span>
                        ) : (
                          <span className="text-[var(--color-success)]">Yes</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
            Showing the first {counts?.sample.length ?? 0} of {counts?.matched ?? 0} matched
            contacts. Uploading a recipient list from CSV is not built here — add the people on the
            Contacts page, tag them, then pick that tag above.
          </p>
        </div>
      )}

      {/* ── 4. Template ── */}
      {step === 3 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelCls}>Approved template</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshTemplates()}
                disabled={refreshing}
                className="text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
              >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
              </button>
              <Link
                href="/templates"
                className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
              >
                Create template ↗
              </Link>
            </div>
          </div>

          {!templatesConfigured && (
            <p className="mb-2 rounded-lg bg-[var(--color-danger-soft)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--color-danger)]">
              WhatsApp is not connected (WHATSAPP_WABA_ID / WHATSAPP_TOKEN are unset), so the
              approved template list cannot be read and no broadcast can be sent.
            </p>
          )}

          <input
            value={templateQuery}
            onChange={(e) => setTemplateQuery(e.target.value)}
            placeholder="Search templates…"
            aria-label="Search templates"
            className={`mb-2 ${inputCls}`}
          />
          <div className="mb-3 max-h-[168px] overflow-y-auto rounded-lg border border-[var(--color-border)]">
            {templates.length === 0 && templatesConfigured && (
              <p className="px-2.5 py-3 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                No approved templates on this account yet. Submit one on the Templates page — Meta
                review takes about 24 hours.
              </p>
            )}
            {templates
              .filter((t) => t.name.toLowerCase().includes(templateQuery.trim().toLowerCase()))
              .map((t) => (
                <button
                  key={`${t.name}-${t.language}`}
                  type="button"
                  onClick={() => chooseTemplate(t)}
                  aria-pressed={spec.templateName === t.name}
                  className={`flex w-full flex-col gap-0.5 border-b border-[var(--color-border)] px-2.5 py-2 text-left last:border-0 ${
                    spec.templateName === t.name
                      ? "bg-[var(--color-accent-soft)]"
                      : "hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  <span className="font-code text-[12px] text-[var(--color-ink)]">
                    {t.name} ({t.language})
                  </span>
                  <span className="line-clamp-1 text-[11.5px] text-[var(--color-muted)]">
                    {t.body}
                  </span>
                </button>
              ))}
          </div>

          {chosen && (
            <div className="flex flex-col gap-3">
              {/* Same placeholder editor the Templates page uses, so the two
                  pages cannot drift apart — the owner's instruction was that
                  Campaigns must match Templates exactly. */}
              <VariableRows
                body={chosen.body}
                bindings={spec.bindings}
                fields={fields}
                sample={sample}
                onBindingsChange={(next: VarBinding[]) => patchSpec({ bindings: next })}
              />
              <MessagePreview
                body={chosen.body}
                buttons={[]}
                bindings={spec.bindings}
                sample={sample}
              />
              <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
                The mapping starts from whatever this template was given on the Templates page;
                changing it here applies to this campaign only. The preview shows the body — a
                header, footer or buttons on the approved template are sent by Meta but are not in
                the list this picker reads.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 5. Test send ── */}
      {step === 4 && (
        <div>
          <label className={labelCls} htmlFor="test-phone">
            Send one copy to a number you can check
          </label>
          <input
            id="test-phone"
            value={testPhone}
            onChange={(e) => {
              setTestPhone(e.target.value);
              setTestArmed(false);
            }}
            inputMode="tel"
            placeholder="60111108822"
            className={inputCls}
          />
          <p className="mb-3 mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
            The number must already be a contact in this company — a test send is not a way to
            message someone who is not in the address book, and it will not create one. This sends
            one real WhatsApp message immediately.
          </p>

          {!testArmed ? (
            <button
              type="button"
              disabled={!testPhone.trim() || !!sendBlocker(spec) || busy}
              onClick={() => setTestArmed(true)}
              className={secondaryBtn}
            >
              Send test message
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onTestSend()}
                className={primaryBtn}
              >
                {busy ? "Sending…" : `Yes — send one real message to ${testPhone}`}
              </button>
              <button type="button" onClick={() => setTestArmed(false)} className={secondaryBtn}>
                Cancel
              </button>
            </div>
          )}

          {testResult && (
            <p className="mt-3 rounded-lg bg-[var(--color-success-soft)] px-2.5 py-2 text-[12px] text-[var(--color-success)]">
              {testResult}
            </p>
          )}
        </div>
      )}

      {/* ── 6. Review ── */}
      {step === 5 && (
        <div>
          {!preview && (
            <button
              type="button"
              disabled={busy || !!sendBlocker(spec)}
              onClick={() => void onReview()}
              className={primaryBtn}
            >
              {busy ? "Checking…" : "Check this campaign"}
            </button>
          )}

          {preview && (
            <div className="mb-3 space-y-2 rounded-lg bg-[var(--color-surface-2)] p-3">
              <div className="text-[13px] text-[var(--color-ink)]">
                <span className="font-mono text-[17px] font-semibold">{preview.recipients}</span>{" "}
                {preview.recipients === 1 ? "person" : "people"} will receive this
              </div>
              <dl className="space-y-1 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
                <div>
                  <dt className="inline text-[var(--color-faint)]">From: </dt>
                  <dd className="inline">{preview.channelLabel}</dd>
                </div>
                <div>
                  <dt className="inline text-[var(--color-faint)]">Template: </dt>
                  <dd className="inline font-code">
                    {preview.templateName} ({preview.templateLang})
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[var(--color-faint)]">Matched: </dt>
                  <dd className="inline">
                    {preview.matched}
                    {preview.blocked > 0 && ` · ${preview.blocked} blocked`}
                    {preview.optedOut > 0 && ` · ${preview.optedOut} opted out`}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[var(--color-faint)]">When: </dt>
                  <dd className="inline">
                    {heldForLater ? `Scheduled for ${scheduleAt.replace("T", " ")}` : "Immediately"}
                  </dd>
                </div>
              </dl>
              {preview.blankSlots.length > 0 && (
                <p className="text-[11.5px]" style={{ color: "var(--color-warning)" }}>
                  {preview.sampleName} has nothing in{" "}
                  {preview.blankSlots.map((n) => `{{${n}}}`).join(", ")} and would read a dash there.
                  Contacts that do have those fields are fine.
                </p>
              )}
              {preview.sampleMessage && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-out)] p-2.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                    What {preview.sampleName} receives
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--color-ink)]">
                    {preview.sampleMessage}
                  </p>
                </div>
              )}
            </div>
          )}

          {preview && !heldForLater && (
            <>
              {!sendArmed ? (
                <button
                  type="button"
                  disabled={busy || !campaignId}
                  onClick={() => setSendArmed(true)}
                  className={primaryBtn}
                >
                  Send broadcast
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onSendForReal()}
                    className="rounded-lg bg-[var(--color-danger)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
                  >
                    {busy
                      ? "Sending…"
                      : `Yes — message ${preview.recipients} ${
                          preview.recipients === 1 ? "person" : "people"
                        } now`}
                  </button>
                  <button type="button" onClick={() => setSendArmed(false)} className={secondaryBtn}>
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {preview && heldForLater && (
            <p className="text-[11.5px] leading-relaxed text-[var(--color-muted)]">
              This campaign is scheduled, so saving keeps it held. It appears at the top of this
              page once it is due, and someone sends it from there.
            </p>
          )}
        </div>
      )}

      {/* ── Footer: what will really happen, and the controls ── */}
      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
          {live
            ? "This system is LIVE: sending here puts real WhatsApp messages on real customers' phones. Every broadcast must be an approved template — Meta refuses free-form text outside the 24-hour reply window."
            : "WhatsApp is not in LIVE mode on this Worker, so messages are recorded here but not delivered. A broadcast still requires an approved template."}
        </p>

        {blockedHere && step < 5 && (
          <p className="mb-2 text-[11.5px]" style={{ color: "var(--color-warning)" }}>
            {blockedHere}
          </p>
        )}
        {error && (
          <p className="mb-2 rounded-lg bg-[var(--color-danger-soft)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--color-danger)]">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-2 rounded-lg bg-[var(--color-success-soft)] px-2.5 py-2 text-[11.5px] text-[var(--color-success)]">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className={secondaryBtn}
          >
            Back
          </button>
          <button
            type="button"
            disabled={step === STEPS.length - 1 || !!blockedHere}
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className={primaryBtn}
          >
            Next
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void onSaveDraft()}
            className={secondaryBtn}
          >
            {busy ? "Saving…" : scheduleEntered ? "Save + schedule" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

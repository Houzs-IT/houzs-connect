"use client";

// The campaign wizard: Audience → Message → Review & send, with the message
// previewed on a phone the whole way through.
//
// What it keeps from the six-step version it replaced: the template is picked
// from the account's APPROVED templates (never typed from memory); every {{n}}
// is bound with the same VariableRows the Templates page uses, so there is one
// mapping mechanism in the product; the recipient count comes from the same
// resolver the send runs; and a send needs a review plus a two-click confirm.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { IconClose } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { templateBindingGaps, type VarBinding } from "@/lib/automation/vars";
import { formatPhone, initials, tint } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { VariableRows } from "@/app/(app)/templates/TemplateFields";
import type { FieldOption } from "@/app/(app)/templates/types";
import {
  countAudience,
  listCampaignTemplates,
  prepareSend,
  saveCampaign,
  sendCampaignNow,
  sendTestMessage,
} from "./actions";
import { PhonePreview, fillBody } from "./PhonePreview";
import {
  NAME_MAX,
  emptySpec,
  sendBlocker,
  toInstant,
  type AudienceCount,
  type AudienceSpec,
  type CampaignSpec,
  type CampaignTemplate,
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
  requiresApproval: boolean;
}

const card = "rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]";
const input =
  "h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)] disabled:opacity-60";
const label = "mb-1.5 block text-[12px] font-semibold text-[var(--color-ink)]";
const btn2 =
  "flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:opacity-40";
const btn1 =
  "flex h-[34px] items-center rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 disabled:shadow-none";

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
  const router = useRouter();
  const { t } = useShell();
  const L = t.camp;

  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState<string | null>(initial?.id ?? null);
  const [savedOnce, setSavedOnce] = useState(!!initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [channelId, setChannelId] = useState(
    initial?.channelId ?? channels.find((c) => c.isDefault)?.id ?? channels[0]?.id ?? ""
  );
  const [spec, setSpec] = useState<CampaignSpec>(initial?.spec ?? emptySpec());
  const [mode, setMode] = useState<"now" | "schedule">(initial?.scheduleAt ? "schedule" : "now");
  const [scheduleAt, setScheduleAt] = useState(initial?.scheduleAt ?? "");
  const [needApproval, setNeedApproval] = useState(initial?.requiresApproval ?? false);
  const [templates, setTemplates] = useState(initialTemplates);
  const [templateQuery, setTemplateQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [armed, setArmed] = useState(false);

  // ── Live recipient count ────────────────────────────────────────────────
  // Keyed on the serialised audience so "is this figure current?" is derived
  // during render rather than written by a setState inside the effect.
  const audKey = JSON.stringify(spec.audience);
  const [counted, setCounted] = useState<{ key: string; data: AudienceCount } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const aud = JSON.parse(audKey) as AudienceSpec;
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

  const chosen = templates.find((x) => x.name === spec.templateName) ?? null;
  const gaps = spec.templateBody ? templateBindingGaps(spec.templateBody, spec.bindings) : [];
  const channel = channels.find((c) => c.id === channelId) ?? null;

  function patchSpec(p: Partial<CampaignSpec>) {
    setSpec((s) => ({ ...s, ...p }));
    setPreview(null);
    setArmed(false);
  }
  const setAudience = (p: Partial<AudienceSpec>) => patchSpec({ audience: { ...spec.audience, ...p } });

  async function refreshTemplates() {
    setRefreshing(true);
    try {
      setTemplates(await listCampaignTemplates());
    } finally {
      setRefreshing(false);
    }
  }

  const currentInput = (schedule: boolean) => ({
    id: campaignId ?? undefined,
    name,
    channelId,
    spec,
    scheduleAt: schedule ? toInstant(scheduleAt) : null,
    requiresApproval: needApproval,
  });

  async function save(schedule: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await saveCampaign(currentInput(schedule));
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return null;
    }
    if (res.id) setCampaignId(res.id);
    setSavedOnce(true);
    return res;
  }

  async function onSaveDraft() {
    const res = await save(mode === "schedule" && !!scheduleAt);
    if (res) setNotice(res.status === "scheduled" ? L.scheduledDone : L.draftSaved);
  }

  async function onPrimary() {
    if (step < 2) return setStep((s) => s + 1);
    if (mode === "schedule") {
      if (!scheduleAt) return setError(L.pastTime);
      const res = await save(true);
      if (!res) return;
      if (res.status !== "scheduled") return setError(L.pastTime);
      router.push("/campaigns");
      return;
    }
    if (needApproval) {
      const res = await save(false);
      if (res) {
        setNotice(L.waitApproval);
        router.push("/campaigns?status=approval");
      }
      return;
    }
    setBusy(true);
    setError(null);
    setArmed(false);
    const res = await prepareSend(currentInput(false));
    setBusy(false);
    if (res.id) {
      setCampaignId(res.id);
      setSavedOnce(true);
    }
    setPreview(res.preview ?? null);
    if (!res.ok) setError(res.error ?? "Could not prepare this send.");
  }

  async function onSendForReal() {
    if (!campaignId) return;
    setBusy(true);
    setError(null);
    // Chunked send (see sendCampaignNow) — loop until nothing remains.
    let res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    while (res.ok && (res.remaining ?? 0) > 0) {
      res = await sendCampaignNow({ campaignId, confirm: "SEND" });
    }
    setBusy(false);
    setArmed(false);
    if (!res.ok) return setError(res.error ?? "The send failed.");
    router.push(`/campaigns/${campaignId}`);
  }

  async function onTestSend() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    const res = await sendTestMessage({ spec, channelId, phone: testPhone });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "The test send failed.");
    setTestResult(fmt(L.testSent, { to: res.to ?? testPhone }));
  }

  // ── Step gating ─────────────────────────────────────────────────────────
  const blocked: (string | null)[] = [
    !name.trim()
      ? L.name
      : !channelId
        ? L.sender
        : !counts
          ? L.counting
          : counts.recipients > 0
            ? null
            : "This audience reaches nobody.",
    sendBlocker(spec) ??
      (gaps.length > 0
        ? `${gaps.map((n) => `{{${n}}}`).join(", ")} still ${gaps.length === 1 ? "has" : "have"} no value.`
        : null),
    null,
  ];
  const reachable = (i: number) => blocked.slice(0, i).every((b) => b == null);

  const steps = [L.stepAudience, L.stepMessage, L.stepReview];
  const primaryLabel =
    step < 2 ? L.next : mode === "schedule" ? L.scheduleCampaign : needApproval ? L.saveDraft : L.sendCampaign;

  const filled = chosen ? fillBody(spec.templateBody, spec.bindings, sample) : null;
  const sampleName = sample?.name || (sample ? formatPhone(sample.phone) : null);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Link
          href="/campaigns"
          aria-label="Close"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
        >
          <IconClose width={15} height={15} />
        </Link>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{name.trim() || L.untitled}</div>
          <div className="truncate text-[11.5px] text-[var(--color-faint)]">{savedOnce ? L.savedJust : L.unsaved}</div>
        </div>

        <ol className="mx-auto hidden items-center gap-2 lg:flex">
          {steps.map((s, i) => {
            const done = i < step;
            const on = i === step;
            return (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-7 bg-[var(--color-border)]" />}
                <button
                  type="button"
                  disabled={!reachable(i)}
                  onClick={() => setStep(i)}
                  className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] font-semibold disabled:cursor-not-allowed ${
                    on ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]"
                  }`}
                >
                  <span
                    className={`grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-bold ${
                      done || on ? "bg-[var(--color-accent)] text-white" : "border border-[var(--color-border-strong)] text-[var(--color-faint)]"
                    }`}
                  >
                    {done ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  {s}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          {step > 0 ? (
            <button type="button" className={btn2} onClick={() => setStep((s) => s - 1)}>
              {L.back}
            </button>
          ) : (
            <button type="button" className={btn2} disabled={busy || !name.trim()} onClick={() => void onSaveDraft()}>
              {L.saveDraft}
            </button>
          )}
          <button
            type="button"
            className={btn1}
            disabled={busy || !!blocked[step] || (step === 2 && !reachable(2))}
            title={blocked[step] ?? undefined}
            onClick={() => void onPrimary()}
          >
            {busy && step === 2 ? L.checking : primaryLabel}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Left: the step ── */}
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto flex max-w-[948px] flex-col gap-4">
            {(error || notice) && (
              <p
                className={`rounded-[10px] px-3 py-2 text-[12.5px] ${
                  error
                    ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                    : "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                }`}
              >
                {error ?? notice}
              </p>
            )}

            {step === 0 && (
              <>
                <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{L.pickAudience}</h1>
                <section className={`${card} grid gap-4 p-4 md:grid-cols-2`}>
                  <div>
                    <label className={label} htmlFor="campaign-name">
                      {L.name}
                    </label>
                    <input
                      id="campaign-name"
                      value={name}
                      maxLength={NAME_MAX}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={L.namePh}
                      className={input}
                    />
                  </div>
                  <div>
                    <label className={label} htmlFor="campaign-channel">
                      {L.sender}
                    </label>
                    <select
                      id="campaign-channel"
                      value={channelId}
                      onChange={(e) => setChannelId(e.target.value)}
                      disabled={channels.length === 0}
                      className={input}
                    >
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName} · {formatPhone(c.phone)}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>

                <section className={`${card} p-4`}>
                  <span className={label}>{L.who}</span>
                  <div className="mb-3 inline-flex gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
                    {(["all", "tag", "attribute"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setAudience({ kind: k })}
                        aria-pressed={spec.audience.kind === k}
                        className={`h-[28px] rounded-[7px] px-3 text-[12.5px] font-semibold ${
                          spec.audience.kind === k
                            ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,23,34,0.08)]"
                            : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        }`}
                      >
                        {k === "all" ? L.byAll : k === "tag" ? L.byTag : L.byAttr}
                      </button>
                    ))}
                  </div>
                  {spec.audience.kind === "tag" && (
                    <div className="flex flex-wrap gap-2">
                      {tags.length === 0 && <span className="text-[12.5px] text-[var(--color-faint)]">{L.noTags}</span>}
                      {tags.map((tg) => {
                        const on = spec.audience.tag === tg.name;
                        return (
                          <button
                            key={tg.name}
                            type="button"
                            onClick={() => setAudience({ tag: tg.name })}
                            className={`flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] ${
                              on
                                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                                : "border-[var(--color-border)] text-[var(--color-ink)] hover:border-[var(--color-border-strong)]"
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ background: tg.color }} />
                            {tg.name}
                            <span className="text-[11px] text-[var(--color-faint)]">{tg.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {spec.audience.kind === "attribute" && (
                    <div className="grid gap-2 md:grid-cols-2">
                      <select
                        aria-label={L.byAttr}
                        value={spec.audience.attrKey ?? ""}
                        onChange={(e) => setAudience({ attrKey: e.target.value })}
                        disabled={attributeFields.length === 0}
                        className={input}
                      >
                        <option value="">{L.chooseAttr}</option>
                        {attributeFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.name} ({f.key})
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Value"
                        value={spec.audience.attrValue ?? ""}
                        onChange={(e) => setAudience({ attrValue: e.target.value })}
                        placeholder={L.attrValue}
                        className={input}
                      />
                    </div>
                  )}
                </section>

                <Breakdown counts={counts} spec={spec.audience} L={L} />
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{L.pickMessage}</h1>
                <section className={`${card} p-4`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`${label} mb-0`}>{L.template}</span>
                    <div className="flex items-center gap-3 text-[12px] font-semibold">
                      <button
                        type="button"
                        onClick={() => void refreshTemplates()}
                        disabled={refreshing}
                        className="text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
                      >
                        {refreshing ? L.checking : L.refresh}
                      </button>
                      <Link href="/templates" className="text-[var(--color-accent)] hover:underline">
                        {L.createTpl}
                      </Link>
                    </div>
                  </div>
                  {!templatesConfigured && (
                    <p className="mb-2 rounded-[8px] bg-[var(--color-danger-soft)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
                      {L.waOff}
                    </p>
                  )}
                  <input
                    value={templateQuery}
                    onChange={(e) => setTemplateQuery(e.target.value)}
                    placeholder={L.searchTpl}
                    className={`${input} mb-2`}
                  />
                  <div className="scroll-thin max-h-[240px] overflow-y-auto rounded-[10px] border border-[var(--color-border)]">
                    {templates.length === 0 && templatesConfigured && (
                      <p className="px-3 py-3 text-[12px] text-[var(--color-faint)]">{L.noTpl}</p>
                    )}
                    {templates
                      .filter((x) => x.name.toLowerCase().includes(templateQuery.trim().toLowerCase()))
                      .map((x) => {
                        const on = spec.templateName === x.name && spec.templateLang === x.language;
                        return (
                          <button
                            key={`${x.name}-${x.language}`}
                            type="button"
                            onClick={() =>
                              patchSpec({
                                templateName: x.name,
                                templateLang: x.language,
                                templateBody: x.body,
                                bindings: x.bindings,
                              })
                            }
                            className={`flex w-full items-start gap-3 border-b border-[var(--color-border-subtle)] px-3 py-2.5 text-left last:border-0 ${
                              on ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-2)]"
                            }`}
                          >
                            <span
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                                on ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"
                              }`}
                            >
                              {on && <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-semibold text-[var(--color-ink)]">
                                {x.name} <span className="font-normal text-[var(--color-faint)]">({x.language})</span>
                              </span>
                              <span className="line-clamp-1 text-[12px] text-[var(--color-muted)]">{x.body}</span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </section>

                {chosen && (
                  <section className={`${card} p-4`}>
                    <VariableRows
                      body={chosen.body}
                      bindings={spec.bindings}
                      fields={fields}
                      sample={sample}
                      onBindingsChange={(next: VarBinding[]) => patchSpec({ bindings: next })}
                    />
                  </section>
                )}

                <section className={`${card} p-4`}>
                  <span className={label}>{L.test}</span>
                  <p className="mb-2 text-[12px] text-[var(--color-faint)]">{L.testHint}</p>
                  <div className="flex gap-2">
                    <input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      inputMode="tel"
                      placeholder="60111108822"
                      className={`${input} max-w-[260px]`}
                    />
                    <button
                      type="button"
                      className={btn2}
                      disabled={!testPhone.trim() || !!sendBlocker(spec) || busy}
                      onClick={() => void onTestSend()}
                    >
                      {L.testBtn}
                    </button>
                  </div>
                  {testResult && <p className="mt-2 text-[12px] text-[var(--color-success)]">{testResult}</p>}
                </section>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{L.checkTitle}</h1>
                <Breakdown counts={counts} spec={spec.audience} L={L} />

                {counts && counts.sample.length > 0 && (
                  <section className={`${card} overflow-hidden`}>
                    <div className="border-b border-[var(--color-border)] px-4 py-3 text-[12px] font-semibold text-[var(--color-ink)]">
                      {L.firstMatched}
                    </div>
                    {counts.sample.map((r) => {
                      const who = r.name || formatPhone(r.phone);
                      const c = tint(r.id);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-2.5 last:border-0"
                        >
                          <span
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold"
                            style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                          >
                            {initials(who)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">{who}</span>
                          <span className="text-[12.5px] tabular-nums text-[var(--color-muted)]">{formatPhone(r.phone)}</span>
                          <span
                            className={`w-[92px] text-right text-[11.5px] font-semibold ${
                              r.blocked
                                ? "text-[var(--color-danger)]"
                                : r.optedOut
                                  ? "text-[var(--color-warning)]"
                                  : "text-[var(--color-success)]"
                            }`}
                          >
                            {r.blocked ? L.blocked : r.optedOut ? L.optedOut : L.willReceiveL}
                          </span>
                        </div>
                      );
                    })}
                  </section>
                )}

                <section className={`${card} p-4`}>
                  <span className={label}>{L.when}</span>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <Choice on={mode === "now"} onClick={() => setMode("now")}>
                      {L.sendNowOpt}
                    </Choice>
                    <Choice on={mode === "schedule"} onClick={() => setMode("schedule")}>
                      {L.scheduleOpt}
                      <span className="text-[var(--color-faint)]">·</span>
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onFocus={() => setMode("schedule")}
                        onChange={(e) => {
                          setScheduleAt(e.target.value);
                          setMode("schedule");
                        }}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-ink)] outline-none"
                      />
                    </Choice>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
                    <input
                      type="checkbox"
                      checked={needApproval}
                      onChange={(e) => setNeedApproval(e.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    {L.needApproval}
                  </label>
                  <p className="mt-3 text-[11.5px] text-[var(--color-faint)]">{live ? L.live : L.notLive}</p>
                </section>
              </>
            )}
          </div>
        </div>

        {/* ── Right: the phone ── */}
        <aside className="hidden w-[392px] shrink-0 flex-col px-5 py-5 xl:flex">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.preview}</div>
          <PhonePreview
            className="min-h-0 flex-1"
            bizName={channel?.displayName ?? "Houzs Century"}
            subtitle={L.businessAccount}
            text={filled}
            time="10:00"
            empty={L.previewEmpty}
          />
          {sampleName && chosen && (
            <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{fmt(L.previewAs, { name: sampleName })}</p>
          )}
        </aside>
      </div>

      <ActionDialog open={!!preview} title={fmt(L.sendTitle, { name })} onClose={() => setPreview(null)}>
        {preview && (
          <div className="flex flex-col gap-2.5">
            <p className="text-[13px] text-[var(--color-ink)]">
              {fmt(L.willGet, {
                n: preview.recipients,
                from: preview.channelLabel,
                tpl: `${preview.templateName} (${preview.templateLang})`,
              })}
            </p>
            {preview.sampleMessage && (
              <p className="whitespace-pre-wrap break-words rounded-[10px] bg-[var(--color-out)] p-3 text-[12.5px] leading-relaxed text-[var(--color-ink)]">
                {preview.sampleMessage}
              </p>
            )}
            {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={btn2} onClick={() => setPreview(null)}>
                {L.back}
              </button>
              {!armed ? (
                <button type="button" className={btn1} disabled={preview.recipients === 0} onClick={() => setArmed(true)}>
                  {L.sendCampaign}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSendForReal()}
                  className="flex h-[34px] items-center rounded-[8px] bg-[var(--color-danger)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  {busy ? L.sendingNow : fmt(L.confirmSend, { n: preview.recipients })}
                </button>
              )}
            </div>
          </div>
        )}
      </ActionDialog>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && onClick()}
      className={`flex h-[40px] cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 text-[13px] text-[var(--color-ink)] ${
        on ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          on ? "border-[var(--color-accent)]" : "border-[var(--color-border-strong)]"
        }`}
      >
        {on && <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />}
      </span>
      {children}
    </div>
  );
}

/** matched = will receive + opted out + blocked — the same split resolveAudience makes. */
function Breakdown({
  counts,
  spec,
  L,
}: {
  counts: AudienceCount | null;
  spec: AudienceSpec;
  L: ReturnType<typeof useShell>["t"]["camp"];
}) {
  if (!counts) {
    return <section className={`${card} p-4 text-[13px] text-[var(--color-faint)]`}>{L.counting}</section>;
  }
  const total = Math.max(counts.matched, 1);
  const pct = (v: number) => `${(v / total) * 100}%`;
  const rule =
    spec.kind === "tag" && spec.tag
      ? fmt(L.ruleTag, { tag: spec.tag })
      : spec.kind === "attribute" && spec.attrKey
        ? fmt(L.ruleAttr, { key: spec.attrKey, val: spec.attrValue ? `= ${spec.attrValue}` : "" })
        : L.ruleAll;
  const tiles: [string, number, string, string][] = [
    [L.matched, counts.matched, "var(--color-surface-2)", "#737c8c"],
    [L.willReceiveL, counts.recipients, "var(--color-pastel-blue)", "var(--color-pastel-blue-ink)"],
    [L.optedOut, counts.optedOut, "var(--color-pastel-orange)", "var(--color-pastel-orange-ink)"],
    [L.blocked, counts.blocked, "var(--color-danger-soft)", "var(--color-danger)"],
  ];
  return (
    <section className={`${card} p-4`}>
      <div className="flex items-baseline gap-2.5">
        <span className="text-[34px] font-medium leading-none tabular-nums text-[var(--color-ink)]">
          {counts.recipients.toLocaleString("en-US")}
        </span>
        <span className="text-[13px] text-[var(--color-muted)]">{L.willReceive}</span>
      </div>
      <div className="mt-4 flex h-[10px] overflow-hidden rounded-full bg-[var(--color-surface-dim)]">
        <span className="bg-[var(--color-pastel-blue-ink)]" style={{ width: pct(counts.recipients) }} />
        <span className="bg-[var(--color-pastel-orange-ink)]" style={{ width: pct(counts.optedOut) }} />
        <span className="bg-[var(--color-danger)]" style={{ width: pct(counts.blocked) }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {tiles.map(([k, v, bg, dot]) => (
          <div key={k} className="rounded-[10px] px-3 py-2.5" style={{ background: bg }}>
            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: dot }} />
              {k}
            </div>
            <div className="mt-1 text-[20px] font-medium tabular-nums text-[var(--color-ink)]">{v.toLocaleString("en-US")}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-[var(--color-faint)]">{fmt(L.matchedNote, { n: counts.matched, rule })}</p>
    </section>
  );
}

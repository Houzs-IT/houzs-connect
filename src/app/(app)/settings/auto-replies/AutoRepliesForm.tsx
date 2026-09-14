"use client";

import { useState, useTransition } from "react";
import { DAYS, type AutoReplySettings, type Day, type WeekHours } from "@/lib/auto-reply/decide";
import { MAX_REPLY_CHARS } from "@/lib/auto-reply/defaults";
import { saveAutoReplies } from "./actions";

const inputCls =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60";
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]";
const btnCls =
  "rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";

const DAY_LABEL: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
      <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

export function AutoRepliesForm({
  initial,
  companyName,
  openNow,
  canEdit,
  lastSaved,
}: {
  initial: AutoReplySettings;
  companyName: string;
  openNow: boolean;
  canEdit: boolean;
  lastSaved: { at: string; by: string | null } | null;
}) {
  const [s, setS] = useState<AutoReplySettings>(initial);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const hours: WeekHours = s.hours ?? {};

  const set = <K extends keyof AutoReplySettings>(k: K, v: AutoReplySettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setDay = (d: Day, v: { open: string; close: string } | null) =>
    setS((p) => ({ ...p, hours: { ...(p.hours ?? {}), [d]: v } }));

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-[var(--color-muted)]">
        Right now {companyName} is <strong className="text-[var(--color-ink)]">{openNow ? "open" : "closed"}</strong>{" "}
        by the hours below (Malaysia time). An automatic reply is sent only when no automation is already handling
        the customer, and at most one automatic reply per customer message.
      </p>

      <Section
        title="Welcome message"
        subtitle="Sent during opening hours when a customer writes in — their first message, or their first after a long silence."
      >
        <div className="flex items-center gap-3">
          <Toggle on={s.welcomeEnabled} onChange={(v) => set("welcomeEnabled", v)} disabled={!canEdit} label="Welcome message on" />
          <span className="text-[13px] text-[var(--color-ink)]">{s.welcomeEnabled ? "On" : "Off"}</span>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className={labelCls}>Message</label>
            <span className="text-[11px] text-[var(--color-faint)]">
              {s.welcomeText.length}/{MAX_REPLY_CHARS}
            </span>
          </div>
          <textarea
            className={`${inputCls} mt-1 min-h-28 w-full`}
            value={s.welcomeText}
            onChange={(e) => set("welcomeText", e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
          Greet the same customer again after
          <input
            type="number"
            min={1}
            max={720}
            className={`${inputCls} w-20`}
            value={s.welcomeAfterHours}
            onChange={(e) => set("welcomeAfterHours", Number(e.target.value))}
            disabled={!canEdit}
          />
          hours of silence.
        </div>
      </Section>

      <Section
        title="Away message"
        subtitle="Sent outside opening hours. Not repeated to the same customer within the time you set, however many messages they send."
      >
        <div className="flex items-center gap-3">
          <Toggle on={s.awayEnabled} onChange={(v) => set("awayEnabled", v)} disabled={!canEdit} label="Away message on" />
          <span className="text-[13px] text-[var(--color-ink)]">{s.awayEnabled ? "On" : "Off"}</span>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className={labelCls}>Message</label>
            <span className="text-[11px] text-[var(--color-faint)]">
              {s.awayText.length}/{MAX_REPLY_CHARS}
            </span>
          </div>
          <textarea
            className={`${inputCls} mt-1 min-h-28 w-full`}
            value={s.awayText}
            onChange={(e) => set("awayText", e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
          Do not repeat it to the same customer within
          <input
            type="number"
            min={1}
            max={168}
            className={`${inputCls} w-20`}
            value={s.awayRepeatHours}
            onChange={(e) => set("awayRepeatHours", Number(e.target.value))}
            disabled={!canEdit}
          />
          hours.
        </div>
      </Section>

      <Section title="Opening hours" subtitle="Malaysia time. A day that is not open counts as closed all day.">
        <div className="space-y-2">
          {DAYS.map((d) => {
            const slot = hours[d] ?? null;
            return (
              <div key={d} className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-[13px] text-[var(--color-ink)]">{DAY_LABEL[d]}</span>
                <Toggle
                  on={!!slot}
                  onChange={(v) => setDay(d, v ? { open: "09:00", close: "18:00" } : null)}
                  disabled={!canEdit}
                  label={`${DAY_LABEL[d]} open`}
                />
                {slot ? (
                  <>
                    <input
                      type="time"
                      className={inputCls}
                      value={slot.open}
                      onChange={(e) => setDay(d, { ...slot, open: e.target.value })}
                      disabled={!canEdit}
                      aria-label={`${DAY_LABEL[d]} opens`}
                    />
                    <span className="text-[12px] text-[var(--color-faint)]">to</span>
                    <input
                      type="time"
                      className={inputCls}
                      value={slot.close}
                      onChange={(e) => setDay(d, { ...slot, close: e.target.value })}
                      disabled={!canEdit}
                      aria-label={`${DAY_LABEL[d]} closes`}
                    />
                  </>
                ) : (
                  <span className="text-[12.5px] text-[var(--color-faint)]">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={btnCls}
            disabled={pending}
            onClick={() => {
              setResult(null);
              start(async () => {
                const r = await saveAutoReplies(s);
                setResult({
                  ok: r.ok,
                  text: r.ok
                    ? `Saved for ${companyName}. ${s.welcomeEnabled || s.awayEnabled ? "Customers will receive these from the next message." : "Both replies are off."}`
                    : (r.error ?? "It could not be saved."),
                });
              });
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {lastSaved && (
            <span className="text-[11.5px] text-[var(--color-faint)]">
              Last saved {new Date(lastSaved.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}
              {lastSaved.by ? ` by ${lastSaved.by}` : ""}
            </span>
          )}
        </div>
      ) : (
        <p className="text-[12.5px] text-[var(--color-muted)]">Only an owner or admin can change these.</p>
      )}
      {result && (
        <p className={`text-[12.5px] ${result.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`} role={result.ok ? "status" : "alert"}>
          {result.text}
        </p>
      )}
    </div>
  );
}

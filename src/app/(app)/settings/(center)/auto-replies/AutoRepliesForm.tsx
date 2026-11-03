"use client";

import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { DAYS, type AutoReplySettings, type Day, type WeekHours } from "@/lib/auto-reply/decide";
import { MAX_REPLY_CHARS } from "@/lib/auto-reply/defaults";
import { fmt } from "@/lib/i18n/dict";
import { saveAutoReplies } from "./actions";

const area =
  "w-full resize-y rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)] disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-muted)]";
const num =
  "mx-1 h-[28px] w-14 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 text-center text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60";
const time =
  "h-[32px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-60";

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

function Card({
  icon,
  tone,
  title,
  sub,
  right,
  children,
}: {
  icon: string;
  tone: string;
  title: string;
  sub: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px]"
          style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h3>
          <p className="text-[12px] text-[var(--color-faint)]">{sub}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function AutoRepliesForm({
  initial,
  companyName,
  openNow,
  canEdit,
  lastSaved,
  draft,
}: {
  initial: AutoReplySettings;
  companyName: string;
  openNow: boolean;
  canEdit: boolean;
  lastSaved: { at: string; by: string | null } | null;
  /** Nothing saved yet — these are the starting drafts. */
  draft: boolean;
}) {
  const { t } = useShell();
  const L = t.set;
  const [s, setS] = useState<AutoReplySettings>(initial);
  const [day, setDayPick] = useState<Day>("mon");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const hours: WeekHours = s.hours ?? {};

  const set = <K extends keyof AutoReplySettings>(k: K, v: AutoReplySettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setDay = (d: Day, v: { open: string; close: string } | null) => setS((p) => ({ ...p, hours: { ...(p.hours ?? {}), [d]: v } }));
  const slot = hours[day] ?? null;
  const preview = s.welcomeEnabled ? s.welcomeText : s.awayEnabled ? s.awayText : s.welcomeText;

  const save = () => {
    setResult(null);
    start(async () => {
      const r = await saveAutoReplies(s);
      setResult({ ok: r.ok, text: r.ok ? L.arSaved : (r.error ?? "It could not be saved.") });
    });
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {draft && (
          <p className="rounded-[12px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] text-[var(--color-muted)]">
            {L.arNotSet}
          </p>
        )}

        <Card
          icon="☺"
          tone="green"
          title={L.arWelcome}
          sub={L.arWelcomeSub}
          right={<Toggle on={s.welcomeEnabled} onChange={(v) => set("welcomeEnabled", v)} disabled={!canEdit} label={L.arWelcome} />}
        >
          <textarea rows={3} maxLength={MAX_REPLY_CHARS} value={s.welcomeText} onChange={(e) => set("welcomeText", e.target.value)} disabled={!canEdit} className={area} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-faint)]">
            <span>
              {fmt(L.arGreetAgain, { n: "\u0000" })
                .split("\u0000")
                .map((part, i) =>
                  i === 0 ? (
                    <span key={i}>{part}</span>
                  ) : (
                    <span key={i}>
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={s.welcomeAfterHours}
                        onChange={(e) => set("welcomeAfterHours", Number(e.target.value))}
                        disabled={!canEdit}
                        className={num}
                      />
                      {part}
                    </span>
                  )
                )}
            </span>
            <span className="tabular-nums">
              {s.welcomeText.length}/{MAX_REPLY_CHARS}
            </span>
          </div>
        </Card>

        <Card
          icon="☾"
          tone="purple"
          title={L.arAway}
          sub={L.arAwaySub}
          right={<Toggle on={s.awayEnabled} onChange={(v) => set("awayEnabled", v)} disabled={!canEdit} label={L.arAway} />}
        >
          <textarea rows={2} maxLength={MAX_REPLY_CHARS} value={s.awayText} onChange={(e) => set("awayText", e.target.value)} disabled={!canEdit} className={area} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-faint)]">
            <span>
              {fmt(L.arRepeat, { n: "\u0000" })
                .split("\u0000")
                .map((part, i) =>
                  i === 0 ? (
                    <span key={i}>{part}</span>
                  ) : (
                    <span key={i}>
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={s.awayRepeatHours}
                        onChange={(e) => set("awayRepeatHours", Number(e.target.value))}
                        disabled={!canEdit}
                        className={num}
                      />
                      {part}
                    </span>
                  )
                )}
            </span>
            <span className="tabular-nums">
              {s.awayText.length}/{MAX_REPLY_CHARS}
            </span>
          </div>
        </Card>

        <Card
          icon="◷"
          tone="blue"
          title={L.arHours}
          sub={s.timezone}
          right={
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                openNow ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${openNow ? "bg-[var(--color-success)]" : "bg-[var(--color-faint)]"}`} />
              {openNow ? L.arOpenNow : L.arClosedNow}
            </span>
          }
        >
          <div className="grid grid-cols-4 gap-2 md:grid-cols-7">
            {DAYS.map((d) => {
              const h = hours[d] ?? null;
              const on = d === day;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayPick(d)}
                  className={`rounded-[10px] border px-2 py-2.5 text-center ${
                    on
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/60 shadow-[0_0_0_1px_var(--color-accent)]"
                      : h
                        ? "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
                  }`}
                >
                  <div className={`text-[12.5px] font-semibold ${h ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"}`}>{L.days[d]}</div>
                  {h ? (
                    <>
                      <div className="mt-1 text-[12px] tabular-nums text-[var(--color-muted)]">{h.open}</div>
                      <div className="text-[12px] tabular-nums text-[var(--color-muted)]">{h.close}</div>
                    </>
                  ) : (
                    <div className="mt-1 text-[12px] text-[var(--color-faint)]">{L.arClosed}</div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] bg-[var(--color-surface-2)] px-3 py-2.5">
            <span className="w-12 text-[13px] font-semibold text-[var(--color-ink)]">{L.days[day]}</span>
            <Toggle on={!!slot} onChange={(v) => setDay(day, v ? { open: "09:00", close: "18:00" } : null)} disabled={!canEdit} label={L.arOpen} />
            {slot ? (
              <>
                <input type="time" className={time} value={slot.open} onChange={(e) => setDay(day, { ...slot, open: e.target.value })} disabled={!canEdit} />
                <span className="text-[12px] text-[var(--color-faint)]">–</span>
                <input type="time" className={time} value={slot.close} onChange={(e) => setDay(day, { ...slot, close: e.target.value })} disabled={!canEdit} />
              </>
            ) : (
              <span className="text-[12.5px] text-[var(--color-faint)]">{L.arClosed}</span>
            )}
          </div>
        </Card>

        <p className="text-[12px] text-[var(--color-faint)]">{L.arNote}</p>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="h-[36px] rounded-[8px] bg-[var(--color-accent)] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40"
            >
              {pending ? L.arSaving : L.arSave}
            </button>
            {lastSaved && (
              <span className="text-[12px] text-[var(--color-faint)]">
                {fmt(L.arLast, {
                  when: new Date(lastSaved.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep"),
                  by: lastSaved.by ? ` · ${lastSaved.by}` : "",
                })}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--color-muted)]">{L.arOnlyAdmins}</p>
        )}
        {result && (
          <p role={result.ok ? "status" : "alert"} className={`text-[12.5px] ${result.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
            {result.text}
          </p>
        )}
      </div>

      <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[320px]">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{t.tf.preview}</div>
        <div className="flex h-[520px] flex-col overflow-hidden rounded-[30px] border-[8px] border-[#0b1020] bg-[#e9e2d6] shadow-[var(--shadow-modal)]">
          <div className="flex items-center gap-2.5 bg-[#1e6f80] px-3 py-2.5 text-white">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-hc-mark.png" alt="" className="h-4 w-4 object-contain" />
            </span>
            <span className="truncate text-[12.5px] font-semibold">{companyName}</span>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-2.5">
            <div className="ml-auto max-w-[80%] rounded-[10px] rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]">{L.arCustomer}</div>
            <div className="max-w-[85%] whitespace-pre-wrap rounded-[10px] rounded-tl-none bg-white px-2.5 py-2 text-[12px] leading-[1.55] text-[var(--color-ink)] shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
              {preview}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

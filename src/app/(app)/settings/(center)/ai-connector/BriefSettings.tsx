"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MyBriefSettings } from "@/lib/mcp/proactive-run";
import { SetCard } from "../ui";
import { previewMyBrief, saveMyBriefSettings, sendMyTestBrief } from "./actions";

// Settings → AI Connector → "Morning brief & alerts" (round 4d). Each person's
// own opt-in, OFF by default. The thresholds are shown read-only: they live in
// one place, src/lib/mcp/proactive.ts PROACTIVE_CONFIG.

const btn = "h-[32px] shrink-0 rounded-[8px] px-3 text-[12.5px] font-semibold disabled:opacity-50";
const primary = `${btn} bg-[var(--color-brand)] text-white`;
const soft = `${btn} border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]`;
const rowCls = "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border-subtle)] px-4 py-3";
const field = "h-[34px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-ink)]";

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const KIND: Record<string, string> = { brief: "Morning brief", brief_test: "Test brief", alert: "Urgent alert", unsubscribe: "Unsubscribed by link" };

const when = (v: string) =>
  v ? new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep") : "—";

function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--color-brand)]" : "bg-[var(--color-border)]"}`}
    >
      <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

export function BriefSettings({ s }: { s: MyBriefSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState(s.subscription);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(s.subscription);

  const say = (ok: boolean, text: string) => setFlash({ ok, text });
  const save = () =>
    start(async () => {
      const r = await saveMyBriefSettings(form);
      say(r.ok, r.ok ? (r.message ?? "Saved.") : (r.error ?? "Could not save."));
      router.refresh();
    });
  const doPreview = () =>
    start(async () => {
      const r = await previewMyBrief(false);
      if (r.ok && r.html) {
        setPreview({ subject: r.subject ?? "", html: r.html });
        setFlash(null);
      } else say(false, r.error ?? "Could not build the preview.");
    });
  const doTest = () =>
    start(async () => {
      const r = await sendMyTestBrief();
      say(r.ok, r.ok ? (r.message ?? "Sent.") : (r.error ?? "Could not send."));
      router.refresh();
    });

  return (
    <SetCard
      icon="✉"
      tone="green"
      title="Morning brief & alerts"
      sub={`Email to ${s.email || "your Connect email"}. Off until you turn it on. Built as you, so it shows only what you can see in Houzs Connect.`}
    >
      {s.mailOff && (
        <div role="status" className="border-t border-[var(--color-border-subtle)] bg-[var(--color-pastel-orange)] px-4 py-2.5 text-[12.5px] text-[var(--color-pastel-orange-ink)]">
          {s.mailOff} Your settings are kept and start working once email is set up.
        </div>
      )}
      {flash && (
        <div
          role="status"
          className={`border-t border-[var(--color-border-subtle)] px-4 py-2.5 text-[12.5px] ${flash.ok ? "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}
        >
          {flash.text}
        </div>
      )}

      <div className={rowCls}>
        <div className="min-w-[180px] flex-1">
          <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">Morning brief</div>
          <div className="text-[12px] text-[var(--color-faint)]">Your chats waiting for you, customers waiting, payments to check, failed messages. Monday adds the data to clean up.</div>
        </div>
        <Toggle on={form.briefEnabled} label="Morning brief" disabled={pending} onChange={(v) => setForm({ ...form, briefEnabled: v })} />
      </div>
      {form.briefEnabled && (
        <div className={rowCls}>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
            Time (Malaysia)
            <select value={form.briefTime} disabled={pending} onChange={(e) => setForm({ ...form, briefTime: e.target.value })} className={field}>
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
            Days
            <select
              value={form.briefDays}
              disabled={pending}
              onChange={(e) => setForm({ ...form, briefDays: e.target.value === "daily" ? "daily" : "weekdays" })}
              className={field}
            >
              <option value="weekdays">Monday to Friday</option>
              <option value="daily">Every day</option>
            </select>
          </label>
        </div>
      )}

      <div className={rowCls}>
        <div className="min-w-[180px] flex-1">
          <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">Urgent alerts</div>
          <div className="text-[12px] text-[var(--color-faint)]">
            {s.supervisor
              ? "A customer waiting too long, a spike in complaints today, a repeat complainer. Each alert at most once a day."
              : "One of your own chats waiting too long for your reply. Each alert at most once a day."}
          </div>
        </div>
        <Toggle on={form.alertsEnabled} label="Urgent alerts" disabled={pending} onChange={(v) => setForm({ ...form, alertsEnabled: v })} />
      </div>

      <div className={rowCls}>
        <button type="button" disabled={pending || !dirty} onClick={save} className={primary}>
          Save
        </button>
        <button type="button" disabled={pending} onClick={doPreview} className={soft}>
          Preview my brief
        </button>
        <button type="button" disabled={pending || !!s.mailOff} onClick={doTest} className={soft} title={s.mailOff ?? "Sends to your own email only; at most once every 10 minutes"}>
          Send me a test brief
        </button>
        <span className="text-[12px] text-[var(--color-faint)]">{s.schedule}</span>
      </div>

      {preview && (
        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-muted)]">
              Preview (not sent): <b className="text-[var(--color-ink)]">{preview.subject}</b>
            </div>
            <button type="button" onClick={() => setPreview(null)} className={soft}>
              Close
            </button>
          </div>
          {/* The email's own HTML, sandboxed: no scripts, links open in a new tab. */}
          <iframe title="Brief preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={preview.html.replace("<head>", '<head><base target="_blank">')} className="h-[520px] w-full rounded-[8px] border border-[var(--color-border)] bg-white" />
        </div>
      )}

      <details className="border-t border-[var(--color-border-subtle)] px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--color-ink)]">Alert levels (set by the admin, read-only)</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[12.5px] md:grid-cols-[minmax(160px,240px)_1fr]">
          {s.thresholds.map((t) => (
            <div key={t.label} className="contents">
              <dt className="text-[var(--color-faint)]">{t.label}</dt>
              <dd className="text-[var(--color-ink)]">{t.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
        <div className="mb-1 text-[12.5px] font-semibold text-[var(--color-ink)]">Emails sent to you</div>
        {s.recent.length === 0 ? (
          <div className="text-[12.5px] text-[var(--color-faint)]">None yet.</div>
        ) : (
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {s.recent.map((r, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-[var(--color-muted)]">
                <span className="text-[var(--color-ink)]">{KIND[r.kind] ?? r.kind}</span>
                <span>{when(r.at)}</span>
                <span>{r.status}</span>
                {r.items > 0 && <span>{r.items} item{r.items === 1 ? "" : "s"}</span>}
                {r.status === "failed" && r.note && <span className="text-[var(--color-danger)]">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SetCard>
  );
}

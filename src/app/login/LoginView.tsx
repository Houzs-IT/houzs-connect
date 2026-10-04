"use client";

import { useActionState, useState } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { login } from "./actions";
import { submitAccessRequest } from "./request-actions";

/*
  Sign in with a Houzs ERP account, on the Connect palette: deep ink-blue sky,
  a teal glow, a field of faint stars, and a white glass card.
*/

// The wordmark PNG is black on transparent; brightness(0) invert(1) turns it white.
const WORDMARK = "/logo-wordmark.png";
const WHITE = { filter: "brightness(0) invert(1)" } as const;

/** The action's own sentences, in the viewer's language. */
const ZH_ERRORS: Record<string, string> = {
  "Wrong email or password.": "邮箱或密码错误。",
  "Enter your email and password.": "请输入邮箱和密码。",
  "Cannot reach the staff directory. Ask IT to grant access.": "无法连接员工目录，请联系 IT。",
};

function Eye({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {off ? (
        <>
          <path d="M10.7 5.1A10.7 10.7 0 0 1 21.9 11.7a1 1 0 0 1 0 .7 10.7 10.7 0 0 1-1.4 2.5" />
          <path d="M14.1 14.2a3 3 0 0 1-4.2-4.2" />
          <path d="M17.5 17.5A10.7 10.7 0 0 1 2.1 12.3a1 1 0 0 1 0-.7 10.7 10.7 0 0 1 4.4-5.1" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2.1 12.3a1 1 0 0 1 0-.7 10.7 10.7 0 0 1 19.8 0 1 1 0 0 1 0 .7 10.7 10.7 0 0 1-19.8 0" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

const CHIP_TONES = ["green", "blue", "pink"];
const CHIP_ICONS = ["☏", "⇄", "↗"];

export function LoginView() {
  const { t, lang, setLang } = useShell();
  const L = t.login;
  const [state, formAction, pending] = useActionState(login, {});
  const [show, setShow] = useState(false);
  const [panel, setPanel] = useState<"none" | "forgot" | "request" | "sent">("none");
  const [req, setReq] = useState({ name: "", email: "", phone: "", department: "", note: "" });
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const sendRequest = async () => {
    setReqBusy(true);
    setReqErr(null);
    const res = await submitAccessRequest(req);
    setReqBusy(false);
    if (res.ok) return setPanel("sent");
    setReqErr(res.error === "email" ? L.errEmail : res.error === "rate" ? L.errRate : res.error === "closed" ? L.errClosed : L.errName);
  };
  const plainInput =
    "h-[44px] w-full rounded-[10px] border border-[var(--color-border)] bg-white px-3.5 text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";
  const year = new Date().getFullYear();
  const error = state.error ? (lang === "zh" ? (ZH_ERRORS[state.error] ?? state.error) : state.error) : null;

  const input = `h-[44px] w-full rounded-[10px] border bg-white px-3.5 text-[14px] text-[var(--color-ink)] outline-none transition-shadow placeholder:text-[var(--color-faint)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)] ${
    error ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]" : "border-[var(--color-border)] focus:border-[var(--color-accent)]"
  }`;
  const label = "mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]";

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "radial-gradient(120% 100% at 30% 0%, #1a2a4a 0%, #111a30 45%, #0b1020 100%)" }}
    >
      {/* Star field and two teal glows */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(rgba(160,190,220,0.35) 1px, transparent 1.2px)", backgroundSize: "46px 46px" }}
      />
      <div className="auth-drift pointer-events-none absolute left-[8%] top-[18%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,160,184,0.22),transparent_70%)] blur-[90px]" />
      <div className="auth-drift2 pointer-events-none absolute bottom-[0%] right-[10%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(30,111,128,0.30),transparent_70%)] blur-[110px]" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={WORDMARK} alt="" aria-hidden draggable={false} style={WHITE} className="pointer-events-none absolute -bottom-10 -left-8 w-[480px] max-w-[64vw] opacity-[0.05]" />

      {/* Language */}
      <div className="absolute right-4 top-4 z-20 flex rounded-full border border-white/20 bg-white/5 p-0.5 md:right-8 md:top-6">
        {(["en", "zh"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${lang === l ? "bg-white text-[#0b1020]" : "text-white/80 hover:text-white"}`}
          >
            {l === "en" ? "EN" : "中文"}
          </button>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-between gap-10 px-5 pb-8 pt-20 lg:flex-row lg:justify-between lg:px-16 lg:py-12">
        {/* Brand */}
        <div className="flex w-full max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
          <div className="animate-rise mb-7 hidden items-center gap-2.5 lg:flex">
            <span className="h-px w-10 bg-[var(--color-brand-bright)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-brand-bright)]">{L.brand}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WORDMARK} alt="Houzs Century" draggable={false} style={WHITE} className="animate-rise h-16 w-auto object-contain sm:h-24 xl:h-32" />
          <span className="animate-rise mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(56,160,184,0.45)] bg-[rgba(56,160,184,0.14)] px-3 py-1 text-[12.5px] font-semibold text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-[#67bed6] shadow-[0_0_8px_#67bed6]" />
            Connect
          </span>
          <p className="animate-rise mt-7 hidden max-w-lg text-[15.5px] leading-relaxed text-[#a9b4c6] lg:block">{L.pitch}</p>
          <div className="animate-rise mt-6 hidden flex-wrap gap-2.5 lg:flex">
            {L.chips.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1 pl-1 pr-3.5 text-[13px] text-white/90">
                <span
                  className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold"
                  style={{ background: `var(--color-pastel-${CHIP_TONES[i]})`, color: `var(--color-pastel-${CHIP_TONES[i]}-ink)` }}
                >
                  {CHIP_ICONS[i]}
                </span>
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Card */}
        <div className="animate-rise w-full max-w-[362px]">
          <div className="rounded-[26px] border border-white/60 bg-[rgba(238,241,244,0.94)] px-5 py-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:px-7 sm:py-8">
            <div className="mb-1 hidden items-center gap-2 sm:flex">
              <span className="h-px w-5 bg-[var(--color-brand)]" />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-brand)]">{L.signIn}</span>
            </div>
            <h1 className="text-[24px] font-bold tracking-tight text-[var(--color-ink)]">
              <span className="sm:hidden">{L.signIn}</span>
              <span className="hidden sm:inline">{L.title}</span>
            </h1>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">{L.sub}</p>

            {panel === "none" ? (
              <form action={formAction} className="mt-6 flex flex-col gap-4">
                <div>
                  <label className={`${label} hidden sm:block`} htmlFor="email">
                    {L.email}
                  </label>
                  <input id="email" name="email" type="email" autoComplete="username" required autoFocus placeholder="you@houzscentury.com" className={input} />
                </div>
                <div>
                  <div className="mb-1.5 hidden items-center justify-between sm:flex">
                    <label className={`${label} mb-0`} htmlFor="password">
                      {L.password}
                    </label>
                    <button type="button" onClick={() => setPanel("forgot")} className="text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
                      {L.forgot}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={show ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder={L.password}
                      className={`${input} pr-11`}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? L.hide : L.show}
                      className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[8px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
                    >
                      <Eye off={show} />
                    </button>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="flex items-center gap-2 rounded-[8px] bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-danger)]">
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--color-danger)] text-[10px] text-white">!</span>
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={pending}
                  className="h-[46px] w-full rounded-[10px] bg-[var(--color-accent)] text-[14px] font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-[var(--color-accent-hi)] disabled:opacity-60"
                >
                  {pending ? L.signingIn : L.submit}
                </button>
                <div className="flex items-center gap-2.5 sm:flex-col sm:gap-0">
                  <button type="button" onClick={() => setPanel("forgot")} className="flex-1 text-[13px] font-semibold text-[var(--color-accent)] sm:hidden">
                    {L.forgot}
                  </button>
                  <span className="hidden text-[12px] text-[var(--color-faint)] sm:block">{L.noAccount}</span>
                  <button
                    type="button"
                    onClick={() => setPanel("request")}
                    className="h-[44px] flex-1 rounded-[10px] border border-[var(--color-border)] bg-white text-[13.5px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] sm:mt-2.5 sm:w-full sm:flex-none"
                  >
                    {L.request}
                  </button>
                </div>
              </form>
            ) : panel === "forgot" ? (
              <div className="mt-6">
                <div className="rounded-[12px] border border-[var(--color-border)] bg-white p-4">
                  <div className="mb-1.5 text-[13.5px] font-semibold text-[var(--color-ink)]">{L.forgot}</div>
                  <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">{L.forgotBody}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPanel("none")}
                  className="mt-4 h-[44px] w-full rounded-[10px] bg-[var(--color-accent)] text-[14px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
                >
                  {L.gotIt}
                </button>
              </div>
            ) : panel === "request" ? (
              <div className="mt-5 flex flex-col gap-3">
                <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">{L.requestBody}</p>
                {(
                  [
                    ["name", L.fullName, "text", ""],
                    ["email", L.workEmail, "email", "you@houzscentury.com"],
                    ["phone", L.phone, "tel", "+60"],
                    ["department", L.department, "text", ""],
                    ["note", L.note, "text", L.notePh],
                  ] as [keyof typeof req, string, string, string][]
                ).map(([k, l, type, ph]) => (
                  <div key={k}>
                    <label className={label} htmlFor={`req-${k}`}>
                      {l}
                    </label>
                    <input
                      id={`req-${k}`}
                      type={type}
                      value={req[k]}
                      placeholder={ph}
                      onChange={(e) => setReq((r) => ({ ...r, [k]: e.target.value }))}
                      className={plainInput}
                    />
                  </div>
                ))}
                {reqErr && <p className="rounded-[8px] bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{reqErr}</p>}
                <button
                  type="button"
                  disabled={reqBusy}
                  onClick={() => void sendRequest()}
                  className="h-[46px] w-full rounded-[10px] bg-[var(--color-accent)] text-[14px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-60"
                >
                  {reqBusy ? L.sending : L.send}
                </button>
                <button type="button" onClick={() => setPanel("none")} className="text-[13px] font-semibold text-[var(--color-accent)]">
                  {L.back}
                </button>
              </div>
            ) : (
              <div className="mt-6">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-success-soft)] text-[16px] text-[var(--color-success)]">✓</span>
                  <div className="text-[15px] font-semibold text-[var(--color-ink)]">{L.sentTitle}</div>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">{L.sentBody}</p>
                <ol className="mt-4 flex flex-col gap-2.5">
                  {[L.step1, L.step2].map((st, i) => (
                    <li key={st} className="flex items-center gap-3 rounded-[10px] border border-[var(--color-border)] bg-white px-3 py-2.5">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                          i === 0 ? "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]" : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-[var(--color-ink)]">{st}</span>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={() => setPanel("none")}
                  className="mt-4 h-[44px] w-full rounded-[10px] bg-[var(--color-accent)] text-[14px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
                >
                  {L.back}
                </button>
              </div>
            )}
          </div>
          <div className="mt-5 text-center text-[10.5px] uppercase tracking-[0.18em] text-[#7d889b]">{fmt(L.footer, { year })}</div>
        </div>
      </div>
    </div>
  );
}

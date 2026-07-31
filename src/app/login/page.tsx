"use client";

import { useActionState, useState, type ReactNode } from "react";
import { login } from "./actions";
import { AmbientSnow } from "@/components/AmbientSnow";

// The wordmark PNG is black-on-transparent, so it gets inverted to cream on the
// Nature Black canvas — exactly the ERP auth-shell treatment.
const LOGO_WORDMARK_SRC = "/logo-wordmark.png";
// brightness(0) flattens any anti-aliased edge to pure black, invert(1) lifts it
// to white — turns the black PNG into a clean cream mark on dark.
const INVERT_TO_CREAM = { filter: "brightness(0) invert(1)" } as const;

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-faint">
      {children}
    </label>
  );
}

// Eye / EyeOff glyphs — lucide-react is not a Connect dependency, so these are
// inlined from lucide's SVG paths (same icons the ERP login uses).
function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

const INPUT_CLASS =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});
  const [showPassword, setShowPassword] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div
      className="relative min-h-screen overflow-hidden text-[#13201c]"
      style={{
        background:
          "radial-gradient(130% 115% at 26% -12%, #1d2519 0%, #141b13 46%, #0c110b 100%)",
      }}
    >
      {/* Fine paper grain over the gradient for depth */}
      <div className="slab-grain pointer-events-none absolute inset-0 opacity-70" />

      {/* Two slow, counter-drifting pine glows = a living aurora behind the brand. */}
      <div className="pointer-events-none absolute left-[10%] top-[14%] h-[560px] w-[560px]">
        <div
          className="auth-drift absolute inset-0 rounded-full blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, rgba(63,107,83,0.26), rgba(63,107,83,0) 70%)",
          }}
        />
      </div>
      <div className="pointer-events-none absolute bottom-[6%] right-[8%] h-[460px] w-[460px]">
        <div
          className="auth-drift2 absolute inset-0 rounded-full blur-[150px]"
          style={{
            background:
              "radial-gradient(circle, rgba(45,75,60,0.5), rgba(45,75,60,0) 70%)",
          }}
        />
      </div>

      {/* Ambient drifting snow — same particle effect as the ERP auth shell */}
      <AmbientSnow />

      {/* Faint wordmark watermark, bottom-left */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_WORDMARK_SRC}
        alt=""
        aria-hidden
        draggable={false}
        style={INVERT_TO_CREAM}
        className="pointer-events-none absolute -bottom-12 -left-10 w-[520px] max-w-[64vw] object-contain opacity-[0.045]"
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-14 px-6 py-12 lg:flex-row lg:justify-between lg:gap-10 lg:px-16">
        {/* Brand lockup — children rise in sequence */}
        <div className="w-full max-w-2xl text-center lg:text-left">
          <div
            className="animate-rise mb-7 flex items-center justify-center gap-2 lg:justify-start"
            style={{ animationDelay: "0ms" }}
          >
            <span className="h-px w-10 bg-brand" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Houzs Century
            </span>
          </div>
          {/* wordmark: rises in → floats gently → a metallic sheen sweeps across it. */}
          <div
            className="animate-rise mx-auto inline-block lg:mx-0"
            style={{ animationDelay: "120ms" }}
          >
            <div className="auth-float relative inline-block overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={LOGO_WORDMARK_SRC}
                alt="Houzs Century"
                draggable={false}
                style={INVERT_TO_CREAM}
                className="block h-24 w-auto max-w-[560px] object-contain drop-shadow-[0_10px_36px_rgba(0,0,0,0.5)] sm:h-28 xl:h-36"
              />
              <span className="auth-sheen pointer-events-none absolute -inset-y-12 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/35 to-transparent blur-2xl" />
            </div>
          </div>
          <p
            className="animate-rise mx-auto mt-9 max-w-lg text-[15.5px] leading-relaxed text-[#6f786d] lg:mx-0"
            style={{ animationDelay: "240ms" }}
          >
            The WhatsApp communication &amp; automation workspace for the Houzs
            Century team — conversations, campaigns, and follow-ups in one place.
          </p>
        </div>

        {/* Liquid-glass floating card */}
        <div
          className="animate-rise w-full max-w-[348px]"
          style={{ animationDelay: "360ms" }}
        >
          <div
            className="relative overflow-hidden rounded-[28px] border border-white/45 bg-white/[0.62] px-7 py-8 backdrop-blur-2xl backdrop-saturate-150"
            style={{
              boxShadow:
                "0 28px 70px -30px rgba(0,0,0,0.85), inset 0 1px 1px rgba(255,255,255,0.85), inset 0 -14px 30px rgba(255,255,255,0.10)",
            }}
          >
            {/* specular highlight catching the glass rim (top-left) */}
            <span className="pointer-events-none absolute -left-10 -top-14 h-40 w-48 rounded-full bg-white/45 blur-3xl" />
            {/* faint counter-highlight, bottom-right */}
            <span className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-40 rounded-full bg-white/15 blur-3xl" />
            {/* brass hairline along the very top edge */}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/55 to-transparent" />

            <div className="relative">
              <div className="mb-1 flex items-center gap-2">
                <span className="h-px w-5 bg-brand" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Sign In
                </span>
              </div>
              <h1 className="font-display text-[25px] font-extrabold leading-tight tracking-tight text-ink">
                Houzs Century Chat
              </h1>
              <p className="mt-1.5 text-[12.5px] text-muted">
                Sign in with your Houzs ERP account
              </p>

              <form action={formAction} className="mt-7 space-y-4">
                <div>
                  <FieldLabel>Email</FieldLabel>
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                    autoFocus
                    placeholder="you@houzscentury.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <FieldLabel>Password</FieldLabel>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      className={`${INPUT_CLASS} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      title={showPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                      className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                {state.error && (
                  <div className="text-[11px] text-danger">{state.error}</div>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-4 text-[13px] font-semibold tracking-wide text-white shadow-sm transition-all duration-150 hover:bg-accent-ink disabled:border-accent/40 disabled:bg-accent/40"
                >
                  {pending ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </div>
          </div>
          <div className="mt-5 text-center text-[10px] uppercase tracking-[0.18em] text-[#6f786d] lg:text-left">
            {year} Houzs Century — authorized staff only
          </div>
        </div>
      </div>
    </div>
  );
}

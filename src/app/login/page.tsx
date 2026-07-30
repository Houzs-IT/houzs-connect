"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.png"
            alt="Houzs Century"
            className="h-16 w-auto object-contain"
          />
          <div className="text-center">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">
              Houzs Century Chat
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-faint)]">
              Sign in with your Houzs ERP account
            </div>
          </div>
        </div>

        <form
          action={formAction}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-card"
        >
          <label className="mb-1.5 block text-[12px] font-medium text-[var(--color-muted)]">
            Email
          </label>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mb-4 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            placeholder="you@houzscentury.com"
          />

          <label className="mb-1.5 block text-[12px] font-medium text-[var(--color-muted)]">
            Password
          </label>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            placeholder="••••••••"
          />

          {state.error && (
            <p className="mt-3 rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-5 w-full rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-[var(--color-faint)]">
          Houzs Century internal — authorized staff only
        </p>
      </div>
    </div>
  );
}

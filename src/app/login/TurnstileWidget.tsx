"use client";

import { useEffect, useRef } from "react";

// Public Turnstile site key (safe to ship). Overridable via env for other envs.
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAGIf5kEYhKKcQQ5z";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile widget (explicit render into our own div, so React keeps
 * control of the surrounding DOM). The widget injects a hidden
 * `cf-turnstile-response` input into the enclosing <form>; the login action
 * verifies it server-side. `resetSignal` resets the widget whenever it changes
 * (we pass the action state, so every submit gets a fresh single-use token).
 *
 * Needs the Turnstile api.js script on the page (loaded once in LoginView).
 */
export function TurnstileWidget({ className, resetSignal }: { className?: string; resetSignal?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const firstSignal = useRef(true);

  useEffect(() => {
    let stopped = false;
    const tryRender = () => {
      if (stopped || idRef.current || !ref.current || !window.turnstile) return false;
      idRef.current = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "light",
      });
      return true;
    };
    const cleanup = () => {
      stopped = true;
      if (idRef.current && window.turnstile) {
        try {
          window.turnstile.remove(idRef.current);
        } catch {}
        idRef.current = null;
      }
    };
    if (tryRender()) return cleanup;
    // api.js may not be ready yet — poll briefly until window.turnstile exists.
    const iv = setInterval(() => {
      if (tryRender()) clearInterval(iv);
    }, 150);
    return () => {
      clearInterval(iv);
      cleanup();
    };
  }, []);

  // Reset to a fresh token after each submit (the previous token is single-use).
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    if (idRef.current && window.turnstile) {
      try {
        window.turnstile.reset(idRef.current);
      } catch {}
    }
  }, [resetSignal]);

  return <div ref={ref} className={className} />;
}

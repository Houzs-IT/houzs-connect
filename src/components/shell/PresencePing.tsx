"use client";

import { useEffect } from "react";
import { pingPresence } from "@/app/presence-actions";

/**
 * Once a minute while this tab is visible, tell the server this member is
 * still here (lib/presence.ts). A hidden tab stops pinging, so someone who
 * walks away drops to offline within two minutes.
 */
export function PresencePing() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void pingPresence(window.location.pathname).catch(() => {}), 60_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void pingPresence(window.location.pathname).catch(() => {});
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}

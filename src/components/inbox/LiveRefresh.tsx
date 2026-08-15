"use client";

// Keeps the inbox current without a reload.
//
// Every page here is a server component, so a new customer message only
// appeared after a manual refresh — the thread felt dead, and an agent had no
// way to know a reply had arrived. There are no WebSockets in this app yet, so
// this polls: router.refresh() re-runs the server render and React reconciles,
// which keeps scroll position and does not flash.
//
// It backs off when the tab is hidden, because a background tab polling the
// database every few seconds is pure cost for nobody's benefit.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), seconds * 1000);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        router.refresh(); // catch up immediately on return
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, seconds]);

  return null;
}

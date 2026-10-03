"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { markChannelRead } from "./actions";

/**
 * Keeps an open channel current: marks it read when it opens or gains
 * messages, and asks the server for new messages every few seconds while the
 * tab is visible. Workers keep no long-lived connections, so this is polling.
 */
export function LiveRefresh({ channelId, count, everyMs = 8000 }: { channelId: string; count: number; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    void markChannelRead(channelId);
  }, [channelId, count]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

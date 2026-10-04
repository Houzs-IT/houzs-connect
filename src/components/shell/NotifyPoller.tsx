"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { checkNotices } from "@/app/notify-actions";

/**
 * Browser alerts while Connect is open in any tab: every 30 seconds ask what
 * happened since the last check, and show a system notification for each —
 * only if the person allowed notifications in this browser. Clicking one opens
 * the chat or channel it is about.
 */
export function NotifyPoller() {
  const router = useRouter();
  const since = useRef<string>(new Date().toISOString());
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const tick = async () => {
      if (Notification.permission !== "granted") return;
      const from = since.current;
      since.current = new Date().toISOString();
      const notes = await checkNotices(from).catch(() => []);
      for (const n of notes) {
        const note = new Notification(n.title, { body: n.body.slice(0, 140), tag: `${n.kind}:${n.href}`, icon: "/icon-192.png" });
        note.onclick = () => {
          window.focus();
          router.push(n.href);
          note.close();
        };
      }
    };
    const timer = setInterval(() => void tick(), 30_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

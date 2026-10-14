"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Browser-side state the shell shares with the IT Support screen:
//  - the unread count (requests IT answered that the person has not opened), its
//    own request so a slow or missing hub never holds up a page render;
//  - the page the person was on before IT Support, sent with a new request so IT
//    can open the right screen.

let unread = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = fetch("/api/it-support/unread-count", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: { unread?: number } | null) => {
      // A failure (not connected, hub down) leaves the last known count as it is.
      if (b) { unread = Number(b.unread) || 0; listeners.forEach((l) => l(unread)); }
    })
    .catch(() => {})
    .finally(() => { fetchedAt = Date.now(); inflight = null; });
  return inflight;
}

/** After opening a request or sending a reply: the count has just changed. */
export function refreshItUnread() { void load(true); }

/** The unread count, polled once a minute while the tab is looked at. `enabled` false => 0, no requests. */
export function useItUnread(enabled: boolean): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setN);
    void load();
    const tick = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { listeners.delete(setN); window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [enabled]);
  return enabled ? n : 0;
}

let lastPage = "";
/** Mounted once in the shell: remembers the last page that is not IT Support itself. */
export function useRememberPage() {
  const path = usePathname();
  useEffect(() => { if (path && !path.startsWith("/it-support")) lastPage = path; }, [path]);
}

/** The page the person was on before IT Support, as a full address IT can open, or "". */
export function pageBeforeItSupport(): string {
  return lastPage ? `${window.location.origin}${lastPage}` : "";
}

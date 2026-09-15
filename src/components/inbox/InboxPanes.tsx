"use client";

import { usePathname } from "next/navigation";

/**
 * Master–detail behaviour for the inbox at phone width.
 *
 * On a desktop the conversation rail and the open thread sit side by side, and
 * they still do above `md`. On a phone there is not room for both, so exactly
 * one shows at a time: the rail on `/inbox`, and the thread on `/inbox/<id>`.
 * The thread carries its own "back" control (see the conversation page) to
 * return to the rail. Which one is showing is a pure function of the route, so
 * it is read here rather than held in state — a back navigation is all it takes
 * to switch, with no extra click to keep in sync.
 */
export function InboxPanes({
  rail,
  children,
}: {
  rail: React.ReactNode;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const detail = /^\/inbox\/[^/]+/.test(path);

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={`min-h-0 w-full md:w-auto ${detail ? "hidden md:flex" : "flex"}`}
      >
        {rail}
      </div>
      <div
        className={`min-w-0 flex-1 ${detail ? "flex" : "hidden md:flex"}`}
      >
        {children}
      </div>
    </div>
  );
}

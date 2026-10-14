"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * The thread's scroll box, pinned to the NEWEST message.
 *
 * The thread is a server component, so it rendered its messages oldest-first
 * in a plain overflow box and the browser left the scroll at the top: every
 * conversation opened on its earliest message and the agent scrolled past
 * weeks of history to find the customer's latest reply (owner, 2026-10-14).
 *
 * Rules: opening a conversation (or switching to another) lands on the bottom.
 * While the agent stays at the bottom, anything that arrives (LiveRefresh's
 * 5 s re-render, an outbound they just sent, an image that finished loading
 * and grew the list) keeps them there. Once they scroll up to read history,
 * new content leaves the scroll where it is — a reply must not yank them away
 * from what they are reading.
 */
export function ThreadScroll({
  conversationId,
  latestKey,
  className,
  children,
}: {
  conversationId: string;
  /** Changes when the newest item changes (id + count): a new message arrived. */
  latestKey: string;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Before paint, so the first frame is already at the bottom — no visible jump.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [latestKey]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      // "At the bottom" with a little slack, so a sub-pixel rounding or a
      // half-visible last bubble still counts as following the conversation.
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    // Content that grows after render (images, lazy media) while we are pinned.
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [conversationId]);

  return (
    <div ref={box} className={className}>
      {children}
    </div>
  );
}

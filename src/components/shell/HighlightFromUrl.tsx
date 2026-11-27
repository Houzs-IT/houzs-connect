"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { DICTS } from "@/lib/i18n/dict";
import { findHighlightTarget, translateLabel, withoutHighlight } from "@/lib/highlight-match";
import { useShell } from "./ShellProvider";

const SEARCH_MS = 3000;
const CLASS = "hc-highlight";

type Tip = { top: number; left: number };

/**
 * `?highlight=<label>` (links from the AI Connector's how_to, round 5): waits for
 * the page, finds the visible element with that label — the English label the
 * guide quotes, or the same label in the person's UI language — retrying about
 * 3 s while data streams in, scrolls to it, outlines it for about 6 s with a
 * small "Here" tip, then drops the parameter with history.replaceState. No
 * parameter = does nothing. It never clicks or edits.
 */
export function HighlightFromUrl() {
  const pathname = usePathname();
  const { lang } = useShell();
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const label = new URLSearchParams(window.location.search).get("highlight");
    if (!label) return;
    const labels = lang === "en" ? [label] : [label, ...translateLabel(label, DICTS.en, DICTS[lang])];
    const started = performance.now();
    let frame = 0;
    let target: HTMLElement | null = null;
    const drop = () => window.history.replaceState(window.history.state, "", withoutHighlight(window.location.href));
    const finish = () => {
      target?.classList.remove(CLASS);
      setTip(null);
    };
    const follow = () => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      setTip({ top: Math.max(4, r.top - 30), left: Math.max(4, r.left) });
      frame = requestAnimationFrame(follow);
    };
    const seek = () => {
      target = findHighlightTarget(document, labels);
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.add(CLASS);
        target.addEventListener(
          "animationend",
          () => {
            cancelAnimationFrame(frame);
            finish();
          },
          { once: true }
        );
        drop();
        frame = requestAnimationFrame(follow);
        return;
      }
      if (performance.now() - started > SEARCH_MS) {
        drop();
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => {
      cancelAnimationFrame(frame);
      finish();
    };
  }, [pathname, lang]);

  if (!tip) return null;
  return createPortal(
    <div role="status" aria-live="polite" className="hc-highlight-tip" style={{ top: tip.top, left: tip.left }}>
      Here
    </div>,
    document.body
  );
}

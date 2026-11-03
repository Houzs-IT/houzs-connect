"use client";

// The ⋯ "Actions" menu that sits at the right of a table row. Its panel is
// rendered on <body> through a portal at a fixed position worked out from the
// trigger's box, so it is never clipped by the table's `overflow-x-auto`
// wrapper (which was cutting it off the right edge, worse at narrow widths).
//
// Placement: the panel's right edge lines up with the button's and it opens
// downward; it is then kept clear of the viewport edges and flipped upward when
// it would run off the bottom. Styling is unchanged from the hand-rolled menus
// this replaces — this is positioning only.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "@/components/icons";

const GAP = 4; // between the trigger and the panel
const EDGE = 8; // keep this far off the viewport edges

export function RowMenu({
  label = "Actions",
  disabled = false,
  width = 176, // matches the old w-44 panels
  pad = "py-1",
  triggerClassName = "grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)] disabled:opacity-40",
  children,
}: {
  /** Trigger aria-label. */
  label?: string;
  disabled?: boolean;
  /** Panel width in px. */
  width?: number;
  /** Panel padding classes (`py-1` for a list of rows, `p-2` for a single control). */
  pad?: string;
  triggerClassName?: string;
  /** The menu items. `close` dismisses the menu after an item runs. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = () => setOpen(false);

  // Measure the trigger and the panel, then keep the panel on screen: align its
  // right edge with the button, clamp horizontally, flip up near the bottom.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const panel = panelRef.current;
    if (!btn || !panel) return;
    const r = btn.getBoundingClientRect();
    const pw = panel.offsetWidth || width;
    const ph = panel.offsetHeight;
    const left = Math.max(EDGE, Math.min(r.right - pw, window.innerWidth - pw - EDGE));
    let top = r.bottom + GAP;
    if (top + ph > window.innerHeight - EDGE) {
      const up = r.top - ph - GAP;
      top = up >= EDGE ? up : Math.max(EDGE, window.innerHeight - ph - EDGE);
    }
    setPos({ top, left });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        <IconDots width={15} height={15} />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[110]" onClick={close} />
            <div
              ref={panelRef}
              role="menu"
              style={{
                position: "fixed",
                width,
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
              className={`z-[120] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] ${pad} shadow-[var(--shadow-popover)]`}
            >
              {children(close)}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

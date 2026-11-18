"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Put a dialog on document.body instead of where it was written.
 *
 * `position: fixed` is only viewport-relative while no ancestor creates a
 * containing block — a `transform`, `filter` or `contain` anywhere above does,
 * and the automation cards sit inside `overflow-hidden` containers. The result
 * was a dialog clipped to a ~130px box with its own scrollbar, its Note field
 * and buttons cut off. A portal takes the whole subtree out of that chain, so
 * `inset-0` means the screen again.
 *
 * No mounted-flag effect is needed and none is used: both dialogs below return
 * null while closed, and `open` starts false, so this is only ever reached after
 * a click — always on the client, never during hydration. The `typeof` guard is
 * belt and braces for a caller that renders one open on first paint.
 */
/**
 * Opt-in `fit` (set by the Automations list only): on a phone the dialog may not
 * be wider than the screen, the overlay scrolls when the screen is short (a
 * keyboard is up), and the footer buttons stack at full width. Without it the
 * dialogs are exactly what they were.
 *
 * Why they overflowed: the overlay was a one-cell grid, and a grid track sizes to
 * its item, so `w-[460px] max-w-full` could never resolve `max-w-full` against
 * the screen and the dialog ran off the right edge below 460px.
 */
const OVERLAY = "fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-ink)_38%,transparent)] p-6";
const OVERLAY_FIT = "fixed inset-0 z-50 flex overflow-y-auto bg-[color-mix(in_srgb,var(--color-ink)_38%,transparent)] p-3 sm:p-6";

function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/**
 * The app's confirmation step for an action that is hard to take back.
 *
 * Publishing an automation is not a UI state change — it makes the flow fire on
 * live customer events and send real WhatsApp messages to real people. Deleting
 * one throws away its graph and its whole version history. Neither should be
 * one stray click, and neither should be a bare "Are you sure?": the body slot
 * is where the caller spells out exactly what is about to happen.
 *
 * Controlled on purpose — the parent owns `open` and the pending state, so the
 * button that opened the dialog can show "Publishing…" while the server action
 * is in flight.
 */
export function ActionConfirm({
  open,
  title,
  confirmLabel,
  busyLabel,
  busy = false,
  danger = false,
  fit = false,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  /** Label while the server action runs. Defaults to `${confirmLabel}…`. */
  busyLabel?: string;
  busy?: boolean;
  /** Paint the confirm button as destructive (delete, unpublish). */
  danger?: boolean;
  /** Responsive dialog for narrow screens (see OVERLAY_FIT). Off by default. */
  fit?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  // Escape closes. Registering a listener is not a state write, so this stays
  // clear of the "no synchronous setState in an effect" rule.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <Portal>
    <div
      role="presentation"
      onClick={onCancel}
      className={fit ? OVERLAY_FIT : OVERLAY}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`${fit ? "m-auto max-h-[85dvh]" : "max-h-[85vh]"} flex w-[460px] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <h2 className={`${fit ? "min-w-0 break-words " : ""}text-[14px] font-semibold text-[var(--color-ink)]`}>{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[15px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            ×
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          {children}
        </div>

        <div className={`flex gap-2 border-t border-[var(--color-border)] px-5 py-4 ${fit ? "flex-col-reverse sm:flex-row sm:justify-end" : "justify-end"}`}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60${fit ? " max-sm:min-h-11" : ""}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? `rounded-lg bg-[var(--color-danger)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60${fit ? " max-sm:min-h-11" : ""}`
                : `rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60${fit ? " max-sm:min-h-11" : ""}`
            }
          >
            {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

/**
 * A plain modal with no confirm/cancel pair — used for the "what needs
 * checking" and edit panels, so every dialog in the app closes the same way
 * (Escape, backdrop, ×).
 */
export function ActionDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = "w-[520px]",
  fit = false,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  /** Responsive dialog for narrow screens (see OVERLAY_FIT). Off by default. */
  fit?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        role="presentation"
        onClick={onClose}
        className={fit ? OVERLAY_FIT : OVERLAY}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          // max-h-[85vh] rather than max-h-full: the dialog should breathe
          // inside the viewport instead of running edge to edge, and the body
          // only scrolls once the content genuinely exceeds that.
          className={`${fit ? "m-auto max-h-[85dvh]" : "max-h-[85vh]"} flex ${width} max-w-full flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0">
              <h2 className={`${fit ? "break-words " : ""}text-[14px] font-semibold text-[var(--color-ink)]`}>{title}</h2>
              {subtitle && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[15px] text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
              ×
            </button>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

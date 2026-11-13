"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * The same cutoff as the `compact` variant in globals.css: under 768px, or a
 * touch screen under 1024px. The real Builder is a desktop tool, so there a tap
 * explains that instead of opening it; everywhere else the link is a plain link.
 */
const COMPACT_QUERY = "(max-width: 47.999rem), (pointer: coarse) and (max-width: 63.999rem)";

/**
 * A link to the Builder. On a compact screen it does not navigate: it calls
 * `onBlocked`, and the owner shows <DesktopNotice>. The notice is owned by the
 * caller, not rendered here, because the ⋯ menu unmounts its items when it closes.
 */
export function OpenBuilderLink({
  id,
  className,
  onBlocked,
  children,
}: {
  id: string;
  className?: string;
  onBlocked: () => void;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent) => {
    if (!window.matchMedia(COMPACT_QUERY).matches) return;
    e.preventDefault();
    onBlocked();
  };
  return (
    <Link href={`/automations/${id}`} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}

/** "Open Houzs Connect on a desktop…" with an OK button; OK stays on the list. */
export function DesktopNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useShell();
  return (
    <ActionDialog fit open={open} title={t.autos.desktopOnly} onClose={onClose} width="w-[420px]">
      <button
        type="button"
        onClick={onClose}
        className="h-11 w-full rounded-lg bg-[var(--color-accent)] text-[13.5px] font-semibold text-white hover:opacity-90"
      >
        {t.autos.ok}
      </button>
    </ActionDialog>
  );
}

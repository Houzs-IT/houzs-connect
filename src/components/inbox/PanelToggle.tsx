"use client";

import { IconPanelClose, IconPanelOpen } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";

/**
 * The customer panel beside a conversation can be put away and brought back.
 * The choice is a cookie (ShellProvider), so the server renders the page the
 * same way on the next visit and nothing jumps.
 */
export function PanelToggle() {
  const { t, panelCollapsed, setPanelCollapsed } = useShell();
  const label = panelCollapsed ? t.service.showPanel : t.service.hidePanel;
  const Icon = panelCollapsed ? IconPanelOpen : IconPanelClose;
  return (
    <button
      type="button"
      onClick={() => setPanelCollapsed(!panelCollapsed)}
      aria-label={label}
      title={label}
      aria-pressed={!panelCollapsed}
      className={`hidden h-[34px] w-[34px] place-items-center rounded-[8px] border transition-colors xl:grid ${
        panelCollapsed
          ? "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          : "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
      }`}
    >
      <Icon width={16} height={16} />
    </button>
  );
}

/** Renders the customer panel only while it is not put away. */
export function PanelGate({ children }: { children: React.ReactNode }) {
  const { panelCollapsed } = useShell();
  return panelCollapsed ? null : <>{children}</>;
}

/**
 * The conversation's ⋯ menu lives in the panel's head on a wide screen; with
 * the panel put away (or on a narrower screen) the header carries it instead.
 */
export function MenuWithoutPanel({ children }: { children: React.ReactNode }) {
  const { panelCollapsed } = useShell();
  return <div className={panelCollapsed ? "" : "xl:hidden"}>{children}</div>;
}

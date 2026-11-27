"use client";

import { useShell } from "@/components/shell/ShellProvider";

/**
 * The customer's name doubles as a show/hide control for the panel beside the
 * thread: clicking it puts the panel away (or brings it back), in step with the
 * header's own PanelToggle and the same cookie. The panel only exists at `xl`,
 * so on a narrower screen the name stays plain text and the click is a no-op —
 * a phone tap must not flip a cookie that only changes the desktop layout.
 */
export function ContactNameToggle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { t, panelCollapsed, setPanelCollapsed } = useShell();
  const label = panelCollapsed ? t.service.showPanel : t.service.hidePanel;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.matchMedia("(min-width: 1280px)").matches) {
          setPanelCollapsed(!panelCollapsed);
        }
      }}
      title={label}
      aria-label={label}
      aria-expanded={!panelCollapsed}
      className={className}
    >
      {children}
    </button>
  );
}

"use client";

// Tab strip for System Logs, mirroring Seampify's (Message History first —
// that is the one operators actually live in).

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/logs", label: "Message History" },
  { href: "/logs/webhooks", label: "Webhook Deliveries" },
];

export function LogTabs() {
  const path = usePathname();
  return (
    <div className="flex gap-1 border-b border-[var(--color-border)] px-6">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              active
                ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

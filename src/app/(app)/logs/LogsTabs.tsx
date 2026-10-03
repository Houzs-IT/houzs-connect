import Link from "next/link";
import type { Dict } from "@/lib/i18n/dict";

/** Message history | Webhook deliveries — the centred tabs in the Logs top bar. */
export function LogsTabs({ L, on }: { L: Dict["logs"]; on: "messages" | "webhooks" }) {
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`flex h-[30px] items-center rounded-[7px] px-3.5 text-[13px] font-semibold ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,23,34,0.08)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
      {tab("/logs", L.messageHistory, on === "messages")}
      {tab("/logs/webhooks", L.webhooks, on === "webhooks")}
    </div>
  );
}

/** "● Live" / "● Demo" — whether sends really leave for Meta. */
export function LiveChip({ live, L }: { live: boolean; L: Dict["logs"] }) {
  return (
    <span className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)]">
      <span className={`h-2 w-2 rounded-full ${live ? "bg-[var(--color-success)]" : "bg-[var(--color-pastel-orange-ink)]"}`} />
      {live ? L.live : L.demo}
    </span>
  );
}

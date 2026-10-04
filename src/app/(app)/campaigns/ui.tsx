import type { Dict } from "@/lib/i18n/dict";

/** A campaign's lifecycle as the list groups it. `due` is a scheduled one whose time has passed. */
export type CampStatus = "draft" | "scheduled" | "due" | "sending" | "sent" | "failed";

export function campStatus(status: string, isDue: boolean): CampStatus {
  if (status === "scheduled") return isDue ? "due" : "scheduled";
  if (status === "sending") return "sending";
  if (status === "completed" || status === "sent") return "sent";
  if (status === "failed") return "failed";
  return "draft";
}

const TONE: Record<CampStatus, string> = {
  draft: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  scheduled: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  due: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  sending: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
  sent: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  failed: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

export function StatusBadge({ s, L, label }: { s: CampStatus; L: Dict["camp"]; label?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${TONE[s]}`}
    >
      {label ?? L[s]}
    </span>
  );
}

const PASTELS = ["blue", "green", "orange", "purple", "pink", "cyan"] as const;

/** The megaphone tile at the start of a row, tinted per campaign. */
export function CampIcon({ seed, size = 36 }: { seed: number; size?: number }) {
  const p = PASTELS[seed % PASTELS.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `var(--color-pastel-${p})`,
        color: `var(--color-pastel-${p}-ink)`,
      }}
    >
      <Megaphone size={Math.round(size * 0.42)} />
    </span>
  );
}

export function Megaphone({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
      <path d="M19 6.5a7 7 0 0 1 0 11" />
    </svg>
  );
}

/** Malaysian wall clock, "5 Oct, 10:00". */
export function whenLabel(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  });
}

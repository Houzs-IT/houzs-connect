export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.replace(/[_-]+/g, " ").trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export function relTime(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function clockTime(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Contact.attributes is stored as JSON (nullable for SQLite). */
export function attrs(a: unknown): Record<string, string> {
  if (!a) return {};
  if (typeof a === "string") {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return a as Record<string, string>;
}

/** Deterministic avatar tint from a string (no Math.random for stability). */
export function tint(seed: string): string {
  const palette = [
    "#e2900a",
    "#0d7490",
    "#2f8f5b",
    "#8e4ec6",
    "#d5493f",
    "#b45309",
    "#0f766e",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

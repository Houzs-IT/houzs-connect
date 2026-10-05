"use client";

import { useState } from "react";
import { initials, tint } from "@/lib/format";

/**
 * A staff member's round avatar: their profile photo (Settings → My profile)
 * when they have one, otherwise initials — which is also what shows if the
 * photo fails to load.
 *
 * Pass `children` to keep a place's own initials look (pastel on the Team
 * page, greyed for "away"); without it, initials on the tint of the name.
 */
export function PersonAvatar({
  name,
  photo,
  size = 32,
  fontSize,
  className = "",
  children,
}: {
  name: string;
  /** From lib/member-photo.ts; null or absent = no photo. */
  photo?: string | null;
  size?: number;
  /** Initials size for the default look; defaults by `size`. */
  fontSize?: number;
  className?: string;
  /** The initials to show when there is no photo. */
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (photo && failed !== photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(photo)}
        className={`shrink-0 rounded-full bg-[var(--color-surface-2)] object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  if (children) return <>{children}</>;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
      style={{
        background: tint(name),
        width: size,
        height: size,
        fontSize: fontSize ?? (size >= 32 ? 12 : size >= 24 ? 10 : 8),
      }}
    >
      {initials(name).toUpperCase()}
    </span>
  );
}

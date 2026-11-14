// Houzs Connect logo mark (scheme 6a) — inline SVG, no external assets.
// From the design handoff (code/HouzsConnectMark.tsx); the only change is the
// wordmark font-family, which points at the next/font Archivo CSS variable
// (--font-archivo) so it uses the self-hosted face instead of a CDN the CSP
// blocks. For theme-reactive use in the app, prefer the wrappers in
// ./HouzsConnectLogo, which pick the variant from the live theme.
//
// Usage:
//   <HouzsConnectMark size={32} />
//   <HouzsConnectMark size={32} variant="white" />   // on dark backgrounds
//   <HouzsConnectLockup />                            // mark + wordmark

import * as React from "react";

type Variant = "color" | "white";

const SEGMENTS = [
  // order: bottom-right → counter-clockwise → top-right
  { company: "Dream Crafter Design", d: "M44.93 49.80A22 22 0 0 1 31.62 54.00", color: "#6b665c", dark: "#bdb8ad" },
  { company: "Hookka Manufacturing", d: "M29.32 53.84A22 22 0 0 1 16.72 47.83", color: "#11140f", dark: "#ffffff" },
  { company: "Carres", d: "M15.15 46.14A22 22 0 0 1 10.03 33.15", color: "#f59a23", dark: "#f59a23" },
  { company: "2990 Home", d: "M10.03 30.85A22 22 0 0 1 15.15 17.86", color: "#ee7d1f", dark: "#ee7d1f" },
  { company: "The Conts", d: "M16.72 16.17A22 22 0 0 1 29.32 10.16", color: "#f2b705", dark: "#f2b705" },
  { company: "Houzs Century", d: "M31.62 10.00A22 22 0 0 1 44.93 14.20", color: "#c99700", dark: "#c99700" },
] as const;

export type HouzsConnectVariant = Variant;

export function HouzsConnectMark({
  size = 32,
  variant = "color",
  title = "Houzs Connect",
  className,
}: {
  size?: number;
  variant?: Variant;
  title?: string;
  className?: string;
}) {
  const white = variant === "white";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title} className={className}>
      {SEGMENTS.map((s) => (
        <path key={s.company} d={s.d} fill="none" stroke={white ? s.dark : s.color} strokeWidth={8} />
      ))}
      {/* Houzs Venture Holding (parent) */}
      <circle cx={32} cy={32} r={7} fill={white ? "#ffffff" : "#11140f"} />
    </svg>
  );
}

export function HouzsConnectLockup({ size = 44, variant = "color" }: { size?: number; variant?: Variant }) {
  const white = variant === "white";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.32 }}>
      <HouzsConnectMark size={size} variant={variant} title="" />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontFamily: "var(--font-archivo), Archivo, sans-serif", lineHeight: 1 }}>
        <span style={{ fontWeight: 800, fontSize: size * 0.545, letterSpacing: ".18em", color: white ? "#fff" : "#11140f" }}>
          HOUZS
        </span>
        <span style={{ fontWeight: 600, fontSize: size * 0.25, letterSpacing: ".52em", color: white ? "#f2b705" : "#8a6a00" }}>
          CONNECT
        </span>
      </div>
    </div>
  );
}

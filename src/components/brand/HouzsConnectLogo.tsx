"use client";

// Theme-reactive Houzs Connect logo for in-app chrome.
//
// The app's light/dark theme is client state (ShellProvider.setTheme flips
// `data-theme` instantly, no reload), so a server-rendered variant would go
// stale the moment someone toggles. These wrappers read the live theme from
// useShell() and pick the variant, so the logo re-themes in step with the rest
// of the app. For a surface whose background is fixed (e.g. the always-dark
// login screen), pass the handoff `HouzsConnectMark` / `HouzsConnectLockup`
// with an explicit `variant` instead.

import { useShell } from "@/components/shell/ShellProvider";
import { HouzsConnectLockup, HouzsConnectMark } from "./HouzsConnectMark";

export function HouzsConnectMarkThemed({ size = 32, className }: { size?: number; className?: string }) {
  const { theme } = useShell();
  return <HouzsConnectMark size={size} variant={theme === "dark" ? "white" : "color"} className={className} />;
}

export function HouzsConnectLockupThemed({ size = 44 }: { size?: number }) {
  const { theme } = useShell();
  return <HouzsConnectLockup size={size} variant={theme === "dark" ? "white" : "color"} />;
}

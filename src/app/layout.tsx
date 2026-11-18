import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getLang, getTheme } from "@/lib/i18n/server";
import "./globals.css";
import "./brand-tokens.css";

/*
  Houzs brand type — one face with the Houzs ERP.

  The ERP self-hosts its faces from `frontend/public/fonts/fonts-v2.css`
  (declared as a <link> in `frontend/index.html:52`) and points body / display /
  mono / money ALL at IBM Plex Sans — `frontend/tailwind.config.js:95,104,119,122`
  — under the owner's 2026-08-01 ruling recorded there verbatim
  ("需要换成全站列表统一字体"). IBM Plex MONO is a separate, narrower alias in the
  ERP (`font-docno`, tailwind.config.js:143) for true fixed-width runs.

  This file used to load Plus Jakarta Sans + Manrope and claim in a comment that
  it "matches the Houzs ERP frontend exactly". It did not: the ERP loads no
  Jakarta and no Manrope anywhere, and pointing every ID / phone / count at IBM
  Plex Mono put its DOTTED ZERO next to the ERP's plain one on every screen —
  the same zero the owner rejected for that role in the ERP on 2026-07-24
  (tailwind.config.js:106-112). Do not reintroduce either family.

  Weights follow the ERP's shipped subset: 400/500/600/700 for Sans, 400/500/600
  for Mono. The ERP additionally declares an 800 face over the same 400-700
  variable file so `font-extrabold` clamps to real 700 outlines instead of
  synthesising; next/font cannot declare that, so Connect uses `font-bold` (700)
  at the one site that wanted 800 — visually the same result, no fake bold.

  All faces are self-hosted from ./fonts (Google's latin files, OFL) through
  next/font/local and served from /_next/static/media, so nothing is fetched
  from a font CDN at build or run time. next/font/google crashed CI builds
  ("Cannot read properties of null (reading '1')", PR #195, 14-16 Nov) when
  Google answered with a font URL it could not parse; a remote font URL at
  runtime would also be blocked by the Worker's CSP.

  CJK (中文) falls through by glyph coverage to whatever "Noto Sans SC" resolves
  to locally, then to the OS face. The ERP self-hosts ~120 Noto SC range chunks;
  Connect deliberately does not bundle them (see globals.css --font-sans).
*/
// Plex Sans: Google's latin variable file (covers 400-700).
const plexSans = localFont({
  src: "./fonts/plex-sans-latin.woff2",
  weight: "400 700",
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/plex-mono-400-latin.woff2", weight: "400" },
    { path: "./fonts/plex-mono-500-latin.woff2", weight: "500" },
    { path: "./fonts/plex-mono-600-latin.woff2", weight: "600" },
  ],
  variable: "--font-plex-mono",
  adjustFontFallback: false, // the only choices are Arial / Times metrics; a mono run should fall back to the CSS monospace stack
  display: "swap",
});
// The Houzs Connect wordmark (logo scheme 6a): Archivo 800 "HOUZS" / 600
// "CONNECT". Google's latin variable file, covers 600-800.
const archivo = localFont({
  src: "./fonts/archivo-latin.woff2",
  weight: "600 800",
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Houzs Connect",
  description:
    "Houzs Century internal WhatsApp communication & automation platform.",
  // Logo scheme 6a. Files live in /public; see /site.webmanifest for the PWA
  // icons. The app icon / favicon does not follow the theme (white-bg mark).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#11140f",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [lang, theme] = await Promise.all([getLang(), getTheme()]);
  return (
    <html
      lang={lang === "zh" ? "zh-CN" : "en"}
      data-theme={theme}
      className={`${plexSans.variable} ${plexMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

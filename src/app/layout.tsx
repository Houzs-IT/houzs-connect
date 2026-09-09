import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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

  next/font/google downloads at BUILD time and serves from /_next/static/media,
  so nothing is fetched from a font CDN at runtime. That is what keeps this
  legal under the Worker's CSP — a remote font URL would be blocked.

  CJK (中文) falls through by glyph coverage to whatever "Noto Sans SC" resolves
  to locally, then to the OS face. The ERP self-hosts ~120 Noto SC range chunks;
  Connect deliberately does not bundle them (see globals.css --font-sans).
*/
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Houzs Century Chat",
  description:
    "Houzs Century internal WhatsApp communication & automation platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

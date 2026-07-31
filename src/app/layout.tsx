import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Houzs brand type — matches the Houzs ERP frontend exactly (its index.html loads
// Plus Jakarta Sans + Manrope + IBM Plex Mono): Plus Jakarta Sans for UI/body,
// Manrope for display/headings, IBM Plex Mono for IDs/phones/money. CJK (中文)
// falls through to Noto Sans SC by glyph coverage (see globals.css stack).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
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
      className={`${jakarta.variable} ${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

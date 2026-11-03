// Only Houzs has a logo file. Any other company (2990s, The Conts, Hookka) must
// never get Houzs's mark on its number card, so it returns null and the card
// shows the company's initial instead.
export function numberLogoSrc(slug: string | null | undefined): string | null {
  return slug === "houzs-century" ? "/logo-hc-mark.png" : null;
}

import { cache } from "react";
import { cookies } from "next/headers";
import { CONTACTS_COLS_COOKIE, DENSITY_COOKIE, DICTS, LANG_COOKIE, MENU_COOKIE, PANEL_COOKIE, THEME_COOKIE, parseLang, parseTheme } from "./dict";

/** The viewer's language, from the `hc_lang` cookie (default English). */
export const getLang = cache(async () => {
  const jar = await cookies();
  return parseLang(jar.get(LANG_COOKIE)?.value);
});

/** The viewer's theme, from the `hc_theme` cookie (default light). Read in the
 *  root layout so <html data-theme> is right on the first paint — no flash. */
export const getTheme = cache(async () => {
  const jar = await cookies();
  return parseTheme(jar.get(THEME_COOKIE)?.value);
});

/** The dictionary for the viewer's language. */
export async function getDict() {
  return DICTS[await getLang()];
}

/** Whether this browser put the conversation's customer panel away (`hc_panel=0`). */
export const getPanelCollapsed = cache(async () => {
  const jar = await cookies();
  return jar.get(PANEL_COOKIE)?.value === "0";
});

/** Whether this browser collapsed the secondary menu (`hc_menu=0`). */
export const getMenuCollapsed = cache(async () => {
  const jar = await cookies();
  return jar.get(MENU_COOKIE)?.value === "0";
});

/**
 * Whether the inbox rows render compact. Compact is the STANDARD DEFAULT for
 * everyone; a person only gets expanded if they explicitly switched to it (the
 * toggle writes `hc_inbox_density=expanded`, remembered per browser). Rendered
 * server-side so the first paint is already the right density — no load flash.
 */
export const getDensityCompact = cache(async () => {
  const jar = await cookies();
  return jar.get(DENSITY_COOKIE)?.value !== "expanded";
});

/** The raw `hc_contacts_cols` cookie (a JSON array string) or "" when unset. The
 *  client parses and validates it; the server only needs to hand the same string
 *  back so the table's first paint already has the browser's chosen columns. */
export const getContactsColsRaw = cache(async () => {
  const jar = await cookies();
  return jar.get(CONTACTS_COLS_COOKIE)?.value ?? "";
});

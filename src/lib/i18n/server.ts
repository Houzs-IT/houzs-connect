import { cache } from "react";
import { cookies } from "next/headers";
import { DICTS, LANG_COOKIE, MENU_COOKIE, parseLang } from "./dict";

/** The viewer's language, from the `hc_lang` cookie (default English). */
export const getLang = cache(async () => {
  const jar = await cookies();
  return parseLang(jar.get(LANG_COOKIE)?.value);
});

/** The dictionary for the viewer's language. */
export async function getDict() {
  return DICTS[await getLang()];
}

/** Whether this browser collapsed the secondary menu (`hc_menu=0`). */
export const getMenuCollapsed = cache(async () => {
  const jar = await cookies();
  return jar.get(MENU_COOKIE)?.value === "0";
});

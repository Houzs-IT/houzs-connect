"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { DENSITY_COOKIE, DICTS, LANG_COOKIE, MENU_COOKIE, PANEL_COOKIE, THEME_COOKIE, type Dict, type Lang, type Theme } from "@/lib/i18n/dict";

type Shell = {
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
  menuCollapsed: boolean;
  setMenuCollapsed: (v: boolean) => void;
  /** The customer panel beside a conversation is put away. */
  panelCollapsed: boolean;
  setPanelCollapsed: (v: boolean) => void;
  /** The inbox conversation rows are in the dense layout. */
  compact: boolean;
  setCompact: (v: boolean) => void;
  /** Light / dark theme. */
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const Ctx = createContext<Shell | null>(null);

const YEAR = 60 * 60 * 24 * 365;
function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
}

/**
 * Client half of the shell state: language and the secondary-menu collapse.
 * Both live in cookies so the server renders the same thing on the next
 * request. A language switch re-renders the server tree (`router.refresh()`),
 * since most copy is rendered there; the menu collapse is purely client-side.
 */
export function ShellProvider({
  lang: initialLang,
  menuCollapsed: initialCollapsed,
  panelCollapsed: initialPanel = false,
  densityCompact: initialCompact = true,
  theme: initialTheme = "light",
  children,
}: {
  lang: Lang;
  menuCollapsed: boolean;
  panelCollapsed?: boolean;
  densityCompact?: boolean;
  theme?: Theme;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [lang, setLangState] = useState(initialLang);
  const [menuCollapsed, setCollapsed] = useState(initialCollapsed);
  const [panelCollapsed, setPanel] = useState(initialPanel);
  const [compact, setCompactState] = useState(initialCompact);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setLang = useCallback(
    (l: Lang) => {
      if (l === lang) return;
      writeCookie(LANG_COOKIE, l);
      setLangState(l);
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
      router.refresh();
    },
    [lang, router]
  );

  const setMenuCollapsed = useCallback((v: boolean) => {
    writeCookie(MENU_COOKIE, v ? "0" : "1");
    setCollapsed(v);
  }, []);

  const setPanelCollapsed = useCallback((v: boolean) => {
    writeCookie(PANEL_COOKIE, v ? "0" : "1");
    setPanel(v);
  }, []);

  const setCompact = useCallback((v: boolean) => {
    writeCookie(DENSITY_COOKIE, v ? "compact" : "expanded");
    setCompactState(v);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    writeCookie(THEME_COOKIE, t);
    setThemeState(t);
    // Flip the attribute now so the whole app re-themes instantly, no reload —
    // the cookie just makes the next server render match.
    document.documentElement.dataset.theme = t;
  }, []);

  return (
    <Ctx.Provider
      value={{ lang, t: DICTS[lang], setLang, menuCollapsed, setMenuCollapsed, panelCollapsed, setPanelCollapsed, compact, setCompact, theme, setTheme }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShell must be used inside <ShellProvider>");
  return v;
}

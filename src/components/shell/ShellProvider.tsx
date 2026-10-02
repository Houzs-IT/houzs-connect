"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { DICTS, LANG_COOKIE, MENU_COOKIE, type Dict, type Lang } from "@/lib/i18n/dict";

type Shell = {
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
  menuCollapsed: boolean;
  setMenuCollapsed: (v: boolean) => void;
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
  children,
}: {
  lang: Lang;
  menuCollapsed: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [lang, setLangState] = useState(initialLang);
  const [menuCollapsed, setCollapsed] = useState(initialCollapsed);

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

  return (
    <Ctx.Provider
      value={{ lang, t: DICTS[lang], setLang, menuCollapsed, setMenuCollapsed }}
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

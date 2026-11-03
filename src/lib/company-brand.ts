// Which company's name and logo to show. Pure, pinned by
// scripts/smoke-company-brand.mjs.
//
// Before sign-in the web address decides. After sign-in the company the person
// is working in decides, logo and colours both, so switching company in the top
// bar switches them (CONNECT-0003).

export type BrandKey = "houzs" | "hookka" | "conts" | "2990";

export interface Brand {
  key: BrandKey;
  name: string;
  /** Square-ish logo for the rail. */
  mark: string;
  /** Large logo for the sign-in page; black or gold on transparent. */
  wordmark: string;
}

const HOUZS_LOGOS = { mark: "/logo-hc-mark.png", wordmark: "/logo-wordmark.png" };

export const BRANDS: Record<BrandKey, Brand> = {
  houzs: { key: "houzs", name: "Houzs Century", ...HOUZS_LOGOS },
  hookka: { key: "hookka", name: "Hookka", mark: "/logo-hookka.png", wordmark: "/logo-hookka.png" },
  conts: { key: "conts", name: "The Conts", mark: "/logo-conts.png", wordmark: "/logo-conts.png" },
  "2990": { key: "2990", name: "2990's Home", mark: "/logo-2990.png", wordmark: "/logo-2990.png" },
};

const HOSTS: Record<string, BrandKey> = {
  "chat.houzscentury.com": "houzs",
  "chat.hookka.com": "hookka",
  "chat.theconts.com": "conts",
  "chat.2990shome.com": "2990",
};

/** The brand of a web address. On a computer, hookka.localhost (conts., 2990.,
 *  houzs.) stands in for the real address. Any other address is Houzs. */
export function brandForHost(host: string | null | undefined): Brand {
  const name = (host ?? "").trim().toLowerCase().split(":")[0];
  const local = name.match(/^(houzs|hookka|conts|2990)\.localhost$/)?.[1] as BrandKey | undefined;
  return BRANDS[local ?? HOSTS[name] ?? "houzs"];
}

/** The brand of a company, by its name. A company with no brand of its own is null. */
export function brandKeyForCompany(name: string): BrandKey | null {
  const n = name.toLowerCase();
  if (n.includes("hookka")) return "hookka";
  if (n.includes("conts")) return "conts";
  if (n.includes("2990")) return "2990";
  if (n.includes("houzs")) return "houzs";
  return null;
}

/** The brand of the company a person is working in: its logo and colours. A company with none of its own is Houzs. */
export function brandForCompany(name: string | null | undefined): Brand {
  return BRANDS[brandKeyForCompany(name ?? "") ?? "houzs"];
}

/**
 * Each company's colours, laid over globals.css (Houzs's). Switching company in
 * the top bar re-renders the shell, so the theme follows.
 */
const THEMES: Partial<Record<BrandKey, Record<string, string>>> = {
  // Hookka's logo is black: graphite rail, charcoal accents.
  hookka: {
    "--color-accent": "#3f3f46",
    "--color-accent-hi": "#18181b",
    "--color-accent-soft": "#ececee",
    "--color-accent-ink": "#18181b",
    "--color-accent-ring": "rgba(63, 63, 70, 0.25)",
    "--color-brand": "#52525b",
    "--color-brand-bright": "#d4d4d8",
    "--color-brand-soft": "#f1f1f3",
    "--color-brand-ink": "#27272a",
    "--color-rail": "#111113",
    "--color-rail-2": "#27272a",
    "--color-rail-active": "rgba(255, 255, 255, 0.14)",
    "--rail-gradient": "linear-gradient(180deg, #27272a 0%, #18181b 45%, #111113 100%)",
  },
  // The Conts' logo is gold: deep ink rail, gold accents.
  conts: {
    "--color-accent": "#8a6534",
    "--color-accent-hi": "#5e4321",
    "--color-accent-soft": "#f5eee3",
    "--color-accent-ink": "#5e4321",
    "--color-accent-ring": "rgba(138, 101, 52, 0.25)",
    "--color-brand": "#a8834e",
    "--color-brand-bright": "#d9b77e",
    "--color-brand-soft": "#f5eee3",
    "--color-brand-ink": "#5e4321",
    "--color-rail": "#14181f",
    "--color-rail-2": "#262d39",
    "--color-rail-active": "rgba(217, 183, 126, 0.22)",
    "--rail-gradient": "linear-gradient(180deg, #2a2418 0%, #1a1c22 45%, #14181f 100%)",
  },
  // 2990's Home's logo is rust (#a6471e) on cream: dark warm rail, rust accents.
  "2990": {
    "--color-accent": "#a6471e",
    "--color-accent-hi": "#733012",
    "--color-accent-soft": "#fbede4",
    "--color-accent-ink": "#733012",
    "--color-accent-ring": "rgba(166, 71, 30, 0.25)",
    "--color-brand": "#a6471e",
    "--color-brand-bright": "#f0a77f",
    "--color-brand-soft": "#fff9eb",
    "--color-brand-ink": "#5c260e",
    "--color-rail": "#1a120e",
    "--color-rail-2": "#2e1f18",
    "--color-rail-active": "rgba(240, 167, 127, 0.22)",
    "--rail-gradient": "linear-gradient(180deg, #33201a 0%, #22160f 45%, #1a120e 100%)",
  },
};

/** The CSS that puts a company's colours on the page; empty for Houzs's own. */
export function themeCss(key: BrandKey): string {
  const vars = THEMES[key];
  if (!vars) return "";
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}

/**
 * The company a sign-in lands in: the web address's company when the person
 * holds it, otherwise the first one they hold. Null means they hold none, and
 * must not get in. Rows come in company order, oldest first.
 */
export function pickLoginRow<T extends { companyName: string }>(rows: T[], host: string | null | undefined): T | null {
  const wanted = brandForHost(host).key;
  return rows.find((r) => brandKeyForCompany(r.companyName) === wanted) ?? rows[0] ?? null;
}

/**
 * The origin a company's pages live on, seen from the address in use; null when
 * switching to it should stay on this address. On a computer the .localhost
 * stand-ins (same port); in production the company's own domain, but only once
 * those domains are live (COMPANY_DOMAINS_LIVE=1), so nobody is sent to an
 * address that does not answer yet. Anywhere else (staging, a preview): stay.
 */
export function companyOrigin(key: BrandKey, host: string | null | undefined, domainsLive: boolean): string | null {
  const [name, port] = (host ?? "").trim().toLowerCase().split(":");
  let target: string | null = null;
  if (name === "localhost" || /^(houzs|hookka|conts|2990)\.localhost$/.test(name)) {
    target = `http://${key === "houzs" ? "localhost" : `${key}.localhost`}${port ? `:${port}` : ""}`;
  } else if (domainsLive && Object.prototype.hasOwnProperty.call(HOSTS, name)) {
    const domain = Object.entries(HOSTS).find(([, k]) => k === key)?.[0];
    target = domain ? `https://${domain}` : null;
  }
  if (!target) return null;
  // Already there: no move.
  return new URL(target).host === (host ?? "").trim().toLowerCase() ? null : target;
}

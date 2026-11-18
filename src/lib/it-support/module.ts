import { NAV } from "@/components/shell/nav";
import { DICTS, type Dict } from "@/lib/i18n/dict";

/**
 * Which part of Connect an IT request is about, so the IT Hub's Reports can say
 * which part has the most problems. The value sent is always the English name
 * (one name per part, whatever language the reporter uses); the picker shows the
 * reporter's own language.
 */
type Part = { path: string; name: (t: Dict) => string };

const PARTS: Part[] = [
  ...NAV.map((n) => ({ path: n.href, name: (t: Dict) => t.nav[n.key] })),
  // Settings pages, each its own part ("Settings · Billing").
  ...(
    [
      ["/settings/profile", (t: Dict) => t.set.profile],
      ["/settings/security", (t: Dict) => t.set.security],
      ["/settings/notifications", (t: Dict) => t.set.notifications],
      ["/settings/roles", (t: Dict) => t.set.roles],
      ["/settings/team", (t: Dict) => t.set.team],
      ["/settings/departments", (t: Dict) => t.set.departments],
      ["/settings/auto-replies", (t: Dict) => t.set.autoReplies],
      ["/settings/library", (t: Dict) => t.set.library],
      ["/settings/developers", (t: Dict) => t.set.developers],
      ["/settings/templates", (t: Dict) => t.tf.templates],
      ["/settings/forms", (t: Dict) => t.tf.forms],
      ["/settings/numbers", (t: Dict) => t.set.channels],
      ["/settings/billing", (t: Dict) => t.set.billing],
      ["/settings/files", (t: Dict) => t.set.files],
      ["/settings/integrations", (t: Dict) => t.set.integrations],
      ["/settings", (t: Dict) => t.set.general],
    ] as const
  ).map(([path, sub]) => ({ path, name: (t: Dict) => `${t.nav.settings} · ${sub(t)}` })),
];

const pathOf = (page: string) => {
  try {
    return new URL(page, "http://x").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
};

/** The English name of the part a page (path or full address) belongs to; "" when none covers it. */
export function itModuleFor(page: string): string {
  const path = pathOf(page);
  if (!path) return "";
  // Longest path first, so /settings/billing wins over /settings.
  const part = [...PARTS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((p) => path === p.path || path.startsWith(`${p.path}/`));
  return part ? part.name(DICTS.en) : "";
}

/** Every part, for the picker: English value, label in the reporter's language. */
export function itModuleOptions(t: Dict): { value: string; label: string }[] {
  return PARTS.map((p) => ({ value: p.name(DICTS.en), label: p.name(t) }));
}

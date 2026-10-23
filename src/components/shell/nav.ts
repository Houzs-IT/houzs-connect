import {
  IconAutomation,
  IconCampaign,
  IconContacts,
  IconDashboard,
  IconForm,
  IconInbox,
  IconInternal,
  IconLifeBuoy,
  IconLogs,
  IconPayments,
  IconSend,
  IconSettings,
} from "../icons";
import type { Dict } from "@/lib/i18n/dict";

export type NavKey = keyof Dict["nav"];

export type NavItem = {
  key: NavKey;
  href: string;
  /** Route prefixes that light this item. Defaults to `[href]`. */
  match?: string[];
  Icon: typeof IconDashboard;
};

/**
 * The rail, top to bottom (design_handoff README · 外壳). Settings is not in
 * this list — it sits at the foot of the rail on its own.
 *
 * "Service" is the display name for what the URL still calls /inbox: links,
 * notifications and webhook redirects all point there, so only the label moved.
 */
export const NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", Icon: IconDashboard },
  { key: "inbox", href: "/inbox", Icon: IconInbox },
  { key: "internal", href: "/internal", Icon: IconInternal },
  { key: "contacts", href: "/contacts", Icon: IconContacts },
  { key: "automations", href: "/automations", Icon: IconAutomation },
  { key: "campaigns", href: "/campaigns", Icon: IconCampaign },
  { key: "broadcast", href: "/broadcast", Icon: IconSend },
  { key: "drip", href: "/drip-campaigns", Icon: IconCampaign },
  { key: "templates", href: "/templates", match: ["/templates", "/forms"], Icon: IconForm },
  { key: "payments", href: "/payments", Icon: IconPayments },
  { key: "logs", href: "/logs", Icon: IconLogs },
];

/**
 * IT Support: report a problem with Connect to IT. At the foot of the rail above
 * Settings, and in the phone's More sheet; shown only where the Worker has the
 * IT Hub's address and key (lib/it-support/hub.ts itSupportConnected).
 */
export const IT_SUPPORT_NAV: NavItem = {
  key: "itSupport",
  href: "/it-support",
  Icon: IconLifeBuoy,
};

export const SETTINGS_NAV: NavItem = {
  key: "settings",
  href: "/settings",
  Icon: IconSettings,
};

export function isActive(item: NavItem, path: string) {
  return (item.match ?? [item.href]).some(
    (p) => path === p || path.startsWith(p + "/")
  );
}

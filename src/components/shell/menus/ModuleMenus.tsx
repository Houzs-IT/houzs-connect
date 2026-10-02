import { getDict } from "@/lib/i18n/server";
import { SecondaryMenu } from "../SecondaryMenu";

/*
  Secondary menus for the modules whose sub-pages are plain routes. Modules
  whose menu is built from data (Service views and tags, Contacts groups, …)
  render their own from the module layout.
*/

export async function LogsMenu() {
  const t = await getDict();
  return (
    <SecondaryMenu
      title={t.nav.logs}
      groups={[
        {
          title: t.menu.views,
          items: [
            { href: "/logs", label: t.page.messages, exact: true },
            { href: "/logs/webhooks", label: t.page.webhooks },
          ],
        },
      ]}
    />
  );
}

/** Templates and WhatsApp forms are one module with two sub-pages. */
export async function TemplatesFormsMenu() {
  const t = await getDict();
  return (
    <SecondaryMenu
      title={t.nav.templates}
      groups={[
        {
          title: t.menu.content,
          items: [
            { href: "/templates", label: t.page.templates },
            { href: "/forms", label: t.page.forms },
          ],
        },
      ]}
    />
  );
}

/**
 * Settings, grouped as in the redesign. Only the pages that exist today are
 * listed; Personal, Roles, Departments, Billing and the rest arrive with the
 * Settings step.
 */
export async function SettingsMenu() {
  const t = await getDict();
  return (
    <SecondaryMenu
      title={t.nav.settings}
      groups={[
        {
          title: t.menu.business,
          items: [
            { href: "/settings", label: t.page.general, exact: true },
            { href: "/settings/team", label: t.page.team },
            { href: "/settings/auto-replies", label: t.page.autoReplies },
          ],
        },
        {
          title: t.menu.more,
          items: [{ href: "/settings/numbers", label: t.page.channels }],
        },
      ]}
    />
  );
}

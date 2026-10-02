import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { companyChoices } from "@/lib/companies";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n/dict";
import type { NavKey } from "./shell/nav";
import { Topbar, type Crumb } from "./Topbar";

/**
 * Server wrapper: one page column — Topbar (breadcrumbs + current member) over
 * a scrollable content area. The first crumb is the module's name (translated
 * from `section`), then `page` (a translated page name), then any `crumbs`
 * the page supplies itself, already in the viewer's language.
 */
export async function PageChrome({
  section,
  page,
  crumbs = [],
  children,
}: {
  section: NavKey;
  page?: keyof Dict["page"];
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login
  const t = await getDict();
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar
        crumbs={[t.nav[section], ...(page ? [t.page[page]] : []), ...crumbs]}
        current={me}
        companies={await companyChoices(getDb(), me)}
      />
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

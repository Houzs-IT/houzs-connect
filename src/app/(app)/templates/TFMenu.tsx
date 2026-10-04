import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { loadBindings, loadFormCounts, loadTemplateList, needsMapping } from "./data";

/** Templates and WhatsApp forms: one module, one menu, counts from both. */
export async function TFMenu() {
  const t = await getDict();
  const L = t.tf;
  const me = await getCurrentMember();
  const [list, forms, bindings] = me
    ? await Promise.all([loadTemplateList(), loadFormCounts(me.companyId), loadBindings(me.companyId)])
    : [{ configured: false, templates: [] }, { total: 0, published: 0, draft: 0 }, { map: new Map(), error: null }];
  const tpl = list.templates;
  const by = (s: string) => tpl.filter((x) => x.status === s).length;
  const unmapped = tpl.filter((x) => needsMapping(x, bindings.map)).length;

  return (
    <SecondaryMenu
      title={t.nav.templates}
      groups={[
        {
          title: L.templates,
          items: [
            { href: "/templates", label: L.all, count: tpl.length, exact: true },
            { href: "/templates?status=APPROVED", label: L.approved, count: by("APPROVED"), dot: "var(--color-success)" },
            { href: "/templates?status=PENDING", label: L.inReview, count: by("PENDING"), dot: "var(--color-pastel-orange-ink)" },
            { href: "/templates?status=REJECTED", label: L.rejected, count: by("REJECTED"), dot: "var(--color-danger)" },
            { href: "/templates?mapping=missing", label: L.needsMapping, count: unmapped, dot: "var(--color-danger)" },
          ],
        },
        {
          title: L.forms,
          items: [
            { href: "/forms", label: L.allForms, count: forms.total, match: [] },
            { href: "/forms?status=published", label: L.inUse, count: forms.published, dot: "var(--color-success)" },
            { href: "/forms?status=draft", label: L.draft, count: forms.draft, dot: "var(--color-border-strong)" },
          ],
        },
        {
          title: L.tools,
          items: [
            { href: "/templates?tool=starter", label: L.starter },
            { href: "/templates?tool=sync", label: L.sync },
          ],
        },
      ]}
    />
  );
}

import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { menuCounts } from "./queries";

/** Contacts' secondary menu: segments, tags and sources, with real counts. */
export async function ContactsMenu() {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const s = t.contacts;
  const m = await menuCounts(me.companyId);
  const fmtN = (n: number) => n.toLocaleString("en-MY");
  return (
    <SecondaryMenu
      title={t.nav.contacts}
      groups={[
        {
          title: s.segments,
          items: [
            { href: "?", label: s.all, count: fmtN(m.all) },
            { href: "?segment=open-order", label: s.openOrder, count: fmtN(m.openOrder) },
            { href: "?segment=balance-due", label: s.balanceDue, count: fmtN(m.balanceDue) },
            { href: "?segment=waiting", label: s.waiting, count: fmtN(m.waiting) },
            { href: "?segment=blocked", label: s.blocked, count: fmtN(m.blocked) },
          ],
        },
        ...(m.tags.length
          ? [
              {
                title: s.tags,
                items: m.tags.map((tg) => ({ href: `?tag=${encodeURIComponent(tg.id)}`, label: tg.name, dot: tg.color })),
              },
            ]
          : []),
        {
          title: s.source,
          items: m.sources
            .filter((r) => r.source !== "test-run")
            .map((r) => ({
              href: `?source=${encodeURIComponent(r.source ?? "none")}`,
              label: s.sources[r.source ?? "none"] ?? r.source ?? s.sources.none,
              count: fmtN(r.n),
            })),
        },
      ]}
    />
  );
}

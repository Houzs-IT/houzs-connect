import { count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { autoReply, channel, company, contactField, department, member, quickReply, tag } from "@/db/schema";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";

/** Settings in three groups, each item with its icon and a one-line summary. */
export async function SettingsMenu() {
  const t = await getDict();
  const L = t.set;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const n = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0).catch(() => 0);
  const [co, people, companies, depts, ar, qr, tags, fields, numbers] = await Promise.all([
    db.query.company.findFirst({ columns: { name: true }, where: eq(company.id, me.companyId) }),
    n(db.select({ n: count() }).from(member).where(eq(member.companyId, me.companyId))),
    n(db.select({ n: count() }).from(company).where(eq(company.active, true))),
    n(db.select({ n: count() }).from(department).where(eq(department.companyId, me.companyId))),
    db.query.autoReply.findFirst({ columns: { welcomeEnabled: true }, where: eq(autoReply.companyId, me.companyId) }).catch(() => undefined),
    n(db.select({ n: count() }).from(quickReply).where(eq(quickReply.companyId, me.companyId))),
    n(db.select({ n: count() }).from(tag).where(eq(tag.companyId, me.companyId))),
    n(db.select({ n: count() }).from(contactField).where(eq(contactField.companyId, me.companyId))),
    n(db.select({ n: count() }).from(channel).where(eq(channel.companyId, me.companyId))),
  ]);

  return (
    <SecondaryMenu
      wide
      title={t.nav.settings}
      groups={[
        {
          title: L.personal,
          items: [
            { href: "/settings/profile", label: L.profile, sub: me.name, icon: "☺", tone: "blue" },
            { href: "/settings/security", label: L.security, sub: L.fromErp, icon: "⚿", tone: "pink" },
            { href: "/settings/notifications", label: L.notifications, sub: L.nBrowser, icon: "♪", tone: "orange" },
          ],
        },
        {
          title: L.business,
          items: [
            { href: "/settings", label: L.general, sub: co?.name ?? "", icon: "▤", tone: "blue", exact: true },
            { href: "/settings/roles", label: L.roles, sub: fmt(L.nRoles, { n: 7 }), icon: "⛨", tone: "purple" },
            { href: "/settings/team", label: L.team, sub: fmt(L.nPeople, { p: people, c: companies }), icon: "⊖", tone: "purple" },
            { href: "/settings/departments", label: L.departments, sub: fmt(L.nDepts, { n: depts }), icon: "▤", tone: "cyan" },
            { href: "/settings/auto-replies", label: L.autoReplies, sub: ar?.welcomeEnabled ? L.welcomeOn : L.welcomeOff, icon: "↺", tone: "cyan" },
            { href: "/settings/library", label: L.library, sub: `${qr} · ${tags} · ${fields}`, icon: "#", tone: "orange" },
            { href: "/settings/developers", label: L.developers, sub: "API", icon: "‹›", tone: "blue" },
          ],
        },
        {
          title: L.more,
          items: [
            { href: "/settings/numbers", label: L.channels, sub: fmt(L.nNumbers, { n: numbers }), icon: "☏", tone: "green" },
            { href: "/settings/billing", label: L.billing, sub: L.spend, icon: "RM", tone: "green" },
            { href: "/settings/files", label: L.files, sub: `${L.fPhotos} · ${L.fDocs}`, icon: "▣", tone: "orange" },
            { href: "/settings/integrations", label: L.integrations, sub: "ERP · WhatsApp", icon: "⇄", tone: "pink" },
          ],
        },
      ]}
      footer={
        <div className="leading-tight">
          <div className="text-[11px] text-[var(--color-faint)]">{L.settingsFor}</div>
          <div className="truncate text-[12.5px] font-semibold text-[var(--color-ink)]">{co?.name ?? ""}</div>
        </div>
      }
    />
  );
}

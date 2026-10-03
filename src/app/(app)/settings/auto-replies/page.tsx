// Auto replies — what a customer receives automatically when they message this
// company's WhatsApp number: a welcome, and an away message outside hours.

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureAutoReplyTable } from "@/db/ensure-auto-reply";
import { autoReply, company } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { isOpen, type WeekHours } from "@/lib/auto-reply/decide";
import { defaultAutoReplies } from "@/lib/auto-reply/defaults";
import { AutoRepliesForm } from "./AutoRepliesForm";
import { bypassReadCache } from "@/db/fresh";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";

export const dynamic = "force-dynamic";

export default async function AutoRepliesPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  await ensureAutoReplyTable(db).catch(() => {});

  const [row, co] = await Promise.all([
    db.query.autoReply
      .findFirst({ where: and(eq(autoReply.companyId, me.companyId), bypassReadCache()) })
      .catch(() => undefined),
    db.query.company.findFirst({ columns: { name: true }, where: eq(company.id, me.companyId) }),
  ]);
  const companyName = co?.name ?? "our company";
  const saved = row
    ? { ...row, hours: (row.hours as WeekHours | null) ?? null }
    : null;
  const settings = saved ?? defaultAutoReplies(companyName);
  const openNow = settings.hours ? isOpen(new Date(), settings.hours, settings.timezone) : true;
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";
  const t = await getDict();

  return (
    <PageChrome section="settings" page="autoReplies">
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={t.set.autoReplies} sub={t.set.arSub} />
        <AutoRepliesForm
          initial={{
            welcomeEnabled: settings.welcomeEnabled,
            welcomeText: settings.welcomeText,
            welcomeAfterHours: settings.welcomeAfterHours,
            awayEnabled: settings.awayEnabled,
            awayText: settings.awayText,
            hours: settings.hours,
            timezone: settings.timezone,
            awayRepeatHours: settings.awayRepeatHours,
          }}
          companyName={companyName}
          openNow={openNow}
          canEdit={canEdit}
          lastSaved={row ? { at: row.updatedAt.toISOString(), by: row.updatedBy } : null}
          draft={!saved}
        />
      </div>
    </PageChrome>
  );
}

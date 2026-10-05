import { redirect } from "next/navigation";
import { and, gt, ne } from "drizzle-orm";
import { Sidebar } from "@/components/Sidebar";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { ShellProvider } from "@/components/shell/ShellProvider";
import { PresencePing } from "@/components/shell/PresencePing";
import { NotifyPoller } from "@/components/shell/NotifyPoller";
import { touchPresence } from "@/lib/presence";
import { getLang, getMenuCollapsed, getPanelCollapsed } from "@/lib/i18n/server";
import { getDb } from "@/db/client";
import { ensureContactColumns } from "@/db/ensure";
import { ensureChannelColumns } from "@/db/ensure-channel";
import { conversation } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { getMyPhotoSrc } from "@/lib/member-photo";
import { bypassReadCache } from "@/db/fresh";
import {
  conversationCompanyWhere,
  conversationVisibilityWhere,
  getVisibility,
} from "@/lib/access";
import { can } from "@/lib/permissions";

// This is a live, data-driven console backed by per-request Cloudflare bindings
// (Hyperdrive). Nothing here is static — force dynamic rendering for the whole
// authenticated app so Next never prerenders a page at build (which would call
// getCloudflareContext outside a request and fail).
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  if (!me) redirect("/login");

  const db = getDb();

  // Runs once per isolate, before ANY page under (app) queries a contact.
  // `blocked` / `updated_at` exist in the Drizzle schema, and Drizzle selects
  // the full column list on every read — so between a deploy and the migration
  // landing, /inbox, /logs, /payments and /dashboard all 500 on a missing
  // column. Gating that on someone visiting /contacts first would leave a real
  // window in which the console is simply down for the team.
  await ensureContactColumns(db).catch(() => {});
  // Same window, for the channel's phone number id (ensure-channel.ts): the
  // automations, campaigns and phone-number pages all read channel rows.
  await ensureChannelColumns(db).catch(() => {});
  // Online status (lib/presence.ts): any page render counts as being here.
  await touchPresence(me.id);

  const allMembers = await db.query.member.findMany({
    columns: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers, await can(me, "seeAll"));
  const unread = await db.$count(
    conversation,
    and(
      conversationCompanyWhere(db, me.companyId),
      conversationVisibilityWhere(vis),
      bypassReadCache(),
      gt(conversation.unreadCount, 0),
      ne(conversation.status, "CLOSED")
    )
  );

  const live = process.env.WHATSAPP_MODE === "LIVE";

  // Shell: 64px rail · [module secondary menu] · page column, with the phone
  // tab bar underneath below `md`. Module layouts render their SecondaryMenu
  // as the first child of the row; every page renders its own column
  // (PageChrome), so the two simply sit side by side.
  return (
    <ShellProvider lang={await getLang()} menuCollapsed={await getMenuCollapsed()} panelCollapsed={await getPanelCollapsed()}>
      <PresencePing />
      <NotifyPoller />
      <div data-shell className="flex h-dvh flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <Sidebar unread={unread} live={live} me={{ name: me.name, photo: await getMyPhotoSrc() }} />
          <div className="flex min-w-0 flex-1">{children}</div>
        </div>
        <MobileTabBar unread={unread} />
      </div>
    </ShellProvider>
  );
}

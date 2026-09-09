import { redirect } from "next/navigation";
import { and, gt, ne } from "drizzle-orm";
import { Sidebar } from "@/components/Sidebar";
import { getDb } from "@/db/client";
import { ensureContactColumns } from "@/db/ensure";
import { conversation } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { getVisibility, conversationVisibilityWhere } from "@/lib/access";

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

  const allMembers = await db.query.member.findMany({
    columns: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers);
  const unread = await db.$count(
    conversation,
    and(
      conversationVisibilityWhere(vis),
      gt(conversation.unreadCount, 0),
      ne(conversation.status, "CLOSED")
    )
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar unread={unread} live={process.env.WHATSAPP_MODE === "LIVE"} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

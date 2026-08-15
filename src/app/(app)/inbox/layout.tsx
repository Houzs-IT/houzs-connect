import { Suspense } from "react";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversation } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { getVisibility, conversationVisibilityWhere } from "@/lib/access";
import { Topbar } from "@/components/Topbar";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationListSkeleton } from "@/components/inbox/ConversationListSkeleton";
import { LiveRefresh } from "@/components/inbox/LiveRefresh";

/** How many conversations the rail loads at once — newest first. */
const LIST_LIMIT = 200;

/**
 * The conversation rail. This is the inbox's expensive query — one row per
 * conversation plus its contact, agent, tags and latest message — so it lives
 * behind its own <Suspense> instead of in the layout body.
 *
 * A `loading.tsx` cannot help here: Next nests the loading boundary *under* the
 * layout, so a blocking layout fetch would still freeze the previous screen for
 * its full duration. Suspending inside the layout is what lets the Topbar and
 * the thread pane paint first.
 */
async function ConversationRail() {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();

  const allMembers = await db.query.member.findMany({
    columns: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers);

  const convos = await db.query.conversation.findMany({
    where: conversationVisibilityWhere(vis),
    orderBy: [desc(conversation.lastMessageAt), desc(conversation.createdAt)],
    limit: LIST_LIMIT,
    with: {
      contact: true,
      assignedAgent: true,
      tagLinks: { with: { tag: true } },
      messages: { orderBy: (m, { desc }) => desc(m.createdAt), limit: 1 },
    },
  });

  const items = convos.map((c) => ({
    id: c.id,
    name: c.contact.name ?? c.contact.phone,
    phone: c.contact.phone,
    status: c.status,
    unread: c.unreadCount,
    lastMessage: c.messages[0]?.body ?? "",
    lastAt: c.messages[0]?.createdAt ?? c.lastMessageAt,
    agent: c.assignedAgent?.name ?? null,
    tags: c.tagLinks.map((t) => ({ name: t.tag.name, color: t.tag.color })),
  }));

  return <ConversationList items={items} />;
}

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login

  return (
    <>
      {/* Poll for new customer messages — no WebSockets in this app yet. */}
      <LiveRefresh seconds={5} />
      <Topbar title="Inbox" subtitle="Shared team inbox" current={me} />
      <div className="flex min-h-0 flex-1">
        <Suspense fallback={<ConversationListSkeleton />}>
          <ConversationRail />
        </Suspense>
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}

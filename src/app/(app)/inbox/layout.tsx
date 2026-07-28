import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/current-member";
import { getVisibility, conversationVisibilityWhere } from "@/lib/access";
import { Topbar } from "@/components/Topbar";
import { ConversationList } from "@/components/inbox/ConversationList";

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  const allMembers = await db.member.findMany({
    select: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers);

  const convos = await db.conversation.findMany({
    where: conversationVisibilityWhere(vis),
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: {
      contact: true,
      assignedAgent: true,
      tagLinks: { include: { tag: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
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

  return (
    <>
      <Topbar
        title="Inbox"
        subtitle={`Shared team inbox · viewing as ${me.name} (${me.role})`}
        current={me}
      />
      <div className="flex min-h-0 flex-1">
        <ConversationList items={items} />
        <div className="flex min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}

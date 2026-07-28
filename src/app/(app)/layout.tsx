import { Sidebar } from "@/components/Sidebar";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/current-member";
import { getVisibility, conversationVisibilityWhere } from "@/lib/access";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  const allMembers = await db.member.findMany({
    select: { id: true, managerId: true },
  });
  const vis = getVisibility(me, allMembers);
  const unread = await db.conversation.count({
    where: {
      ...conversationVisibilityWhere(vis),
      unreadCount: { gt: 0 },
      status: { not: "CLOSED" },
    },
  });

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar unread={unread} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

import { Suspense } from "react";
import { getCurrentMember } from "@/lib/current-member";
import { Topbar } from "@/components/Topbar";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationListSkeleton } from "@/components/inbox/ConversationListSkeleton";
import { LiveRefresh } from "@/components/inbox/LiveRefresh";
import { fetchConversations } from "./actions";

/**
 * The conversation rail. This is the inbox's expensive query — one row per
 * conversation plus its contact, agent, tags and latest message — so it lives
 * behind its own <Suspense> instead of in the layout body.
 *
 * A `loading.tsx` cannot help here: Next nests the loading boundary *under* the
 * layout, so a blocking layout fetch would still freeze the previous screen for
 * its full duration. Suspending inside the layout is what lets the Topbar and
 * the thread pane paint first.
 *
 * The query itself lives in ./actions so that "Load more" fetches through the
 * exact same code path — a second copy of it would be free to drift.
 */
async function ConversationRail() {
  const me = await getCurrentMember();
  if (!me) return null;

  const { items, hasMore } = await fetchConversations(0);
  return <ConversationList items={items} hasMore={hasMore} />;
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

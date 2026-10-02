import { Suspense } from "react";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { companyChoices } from "@/lib/companies";
import { getDict } from "@/lib/i18n/server";
import { Topbar } from "@/components/Topbar";
import { ConversationList } from "@/components/inbox/ConversationList";
import { ConversationListSkeleton } from "@/components/inbox/ConversationListSkeleton";
import { LiveRefresh } from "@/components/inbox/LiveRefresh";
import { InboxPanes, InboxTopbarSlot } from "@/components/inbox/InboxPanes";
import { ServiceMenu } from "@/components/inbox/ServiceMenu";
import { SecondaryMenuSkeleton } from "@/components/shell/SecondaryMenu";
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
  return (
    <ConversationList
      items={items}
      hasMore={hasMore}
      me={{ id: me.id, departmentId: me.departmentId }}
    />
  );
}

export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login

  const t = await getDict();
  return (
    <>
      {/* Counts are their own queries; the rail and thread must not wait on them. */}
      <Suspense fallback={<SecondaryMenuSkeleton title={t.nav.inbox} />}>
        <ServiceMenu me={me} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Poll for new customer messages — no WebSockets in this app yet. */}
      <LiveRefresh seconds={5} />
      <InboxTopbarSlot>
        <Topbar
          crumbs={[t.nav.inbox, t.page.allConversations]}
          mobileTitle={t.nav.inbox}
          current={me}
          companies={await companyChoices(getDb(), me)}
        />
      </InboxTopbarSlot>
      <InboxPanes
        rail={
          <Suspense fallback={<ConversationListSkeleton />}>
            <ConversationRail />
          </Suspense>
        }
      >
        {children}
      </InboxPanes>
      </div>
    </>
  );
}

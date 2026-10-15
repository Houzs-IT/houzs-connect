import Link from "next/link";
import { notFound } from "next/navigation";
import { IconPanelOpen } from "@/components/icons";
import { CompanySwitcher, LangToggle } from "@/components/shell/TopbarControls";
import { getDb } from "@/db/client";
import { companyChoices, isOwnerOrAdmin } from "@/lib/companies";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { photoSrcs } from "@/lib/member-photo";
import { companyPresence } from "@/lib/presence";
import { isAdminRole } from "@/lib/permissions";
import { channelEvents, channelInfo, channelMembers, channelMessages, channelShared, ensureInternal, threadMessages } from "./data";
import { ChannelIcon, ChannelInfo } from "./ChannelInfo";
import { Composer } from "./Composer";
import { ChannelMenu } from "./ChannelMenu";
import { JoinGate } from "./JoinGate";
import { LiveRefresh } from "./LiveRefresh";
import { Avatar, MessageRow, dayKey } from "./parts";

/**
 * One channel or DM: the timeline, the composer, and beside it an open thread
 * or (?info=1) the channel's info panel.
 */
export async function ChannelView({ channelId, threadId, info = false }: { channelId: string; threadId?: string | null; info?: boolean }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.internal;
  await ensureInternal(me.companyId, me.id);
  const ch = await channelInfo(me.companyId, channelId, me.id);
  if (!ch) notFound();
  const companyAdmin = isAdminRole(me.role);
  const isChannel = ch.kind === "channel";
  const canManage = isChannel && (companyAdmin || ch.isChannelAdmin);
  // What the channel's permissions let this member do (channel and company admins always may).
  const canEdit = canManage || (isChannel && ch.isMember && ch.permEdit === "all");
  const canAdd = canManage || (isChannel && ch.isMember && ch.permAdd === "all");
  const canPost = !isChannel || ch.permPost === "all" || canManage;
  const showInfo = isChannel && info;
  const infoHref = showInfo ? `/internal/${ch.id}` : `/internal/${ch.id}?info=1`;
  const title = isChannel ? `# ${ch.name}` : ch.name;

  // Not in this channel: what it is, and Join / Request to join, instead of its messages.
  if (isChannel && !ch.isMember) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <Link href="/internal" className="grid h-8 w-8 place-items-center text-[18px] text-[var(--color-muted)] md:hidden" aria-label={L.back}>
            ‹
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-[var(--color-ink)]">{title}</h1>
          <CompanySwitcher companies={await companyChoices(getDb(), me)} canCreateCompany={isOwnerOrAdmin(me.role)} className="hidden md:block" />
          <LangToggle className="hidden md:flex" />
          {canManage && <ChannelMenu id={ch.id} name={ch.name} topic={ch.topic} access={ch.access} />}
        </header>
        <JoinGate
          id={ch.id}
          name={ch.name}
          topic={ch.topic}
          members={ch.memberCount}
          access={ch.access}
          pending={ch.isPending}
          direct={ch.access === "open" || companyAdmin}
        />
      </div>
    );
  }

  const [msgs, people, thread, members, events, shared] = await Promise.all([
    channelMessages(ch.id),
    companyPresence(me.companyId),
    threadId && !showInfo ? threadMessages(ch.id, threadId) : Promise.resolve([]),
    isChannel ? channelMembers(ch.id) : Promise.resolve([]),
    showInfo ? channelEvents(ch.id) : Promise.resolve([]),
    showInfo ? channelShared(ch.id) : Promise.resolve({ links: [], conversations: [] }),
  ]);
  const names = people.map((p) => p.name);
  const inChannel = members.filter((m) => m.state === "member");
  const photos = await photoSrcs([...people.map((p) => p.id), ...members.map((m) => m.id)]);
  const faces = (isChannel ? inChannel : people).slice(0, 3).map((p) => ({ id: p.id, name: p.name, photo: photos.get(p.id) ?? null }));
  // In a channel, @ offers its members; in a DM, the colleague.
  const mentionable = (isChannel ? inChannel : people).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name }));
  const today = dayKey(new Date());
  const memberCount = isChannel ? inChannel.length : 2;
  const root = thread[0] ?? null;
  const side = root !== null || showInfo;
  // The panel button opens the latest thread, or closes the open one.
  const latestThread = [...msgs].reverse().find((m) => m.replies > 0);
  const panelHref = root ? `/internal/${ch.id}` : latestThread ? `/internal/${ch.id}?t=${latestThread.id}` : null;

  return (
    <div className="flex min-w-0 flex-1">
      <LiveRefresh channelId={ch.id} count={msgs.length + thread.length} />
      <div className={`min-w-0 flex-1 flex-col ${side ? "hidden lg:flex" : "flex"}`}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
          <Link href="/internal" className="grid h-8 w-8 place-items-center text-[18px] text-[var(--color-muted)] md:hidden" aria-label={L.back}>
            ‹
          </Link>
          {isChannel ? (
            // The name opens the channel's info, like tapping a WhatsApp group's name.
            <Link href={infoHref} scroll={false} title={L.openInfo} className="flex min-w-0 flex-1 items-center gap-2.5">
              <ChannelIcon icon={ch.icon} size={32} />
              <span className="min-w-0 flex-1 leading-tight md:flex md:items-baseline md:gap-2.5">
                <h1 className="truncate text-[16px] font-semibold text-[var(--color-ink)]">{title}</h1>
                {ch.topic && <p className="hidden truncate text-[12.5px] text-[var(--color-faint)] md:block">{ch.topic.split("\n")[0]}</p>}
                <p className="text-[11.5px] text-[var(--color-faint)] md:hidden">{fmt(L.members, { n: memberCount })}</p>
              </span>
            </Link>
          ) : (
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="truncate text-[16px] font-semibold text-[var(--color-ink)]">{title}</h1>
            </div>
          )}
          {isChannel ? (
            <Link
              href={infoHref}
              scroll={false}
              title={L.openInfo}
              className={`hidden items-center gap-2 rounded-[8px] border px-2 py-1 md:flex ${
                showInfo ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <span className="flex -space-x-1.5">
                {faces.map((p) => (
                  <span key={p.id} className="rounded-full ring-2 ring-white">
                    <Avatar name={p.name} photo={p.photo} size={20} />
                  </span>
                ))}
              </span>
              <span className="text-[12.5px] text-[var(--color-muted)]">{fmt(L.members, { n: memberCount })}</span>
              {canManage && ch.pendingCount > 0 && (
                <span className="rounded-full bg-[var(--color-warning)] px-1.5 text-[10.5px] font-semibold text-white">{ch.pendingCount}</span>
              )}
            </Link>
          ) : (
            <span className="hidden items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-2 py-1 md:flex">
              <span className="flex -space-x-1.5">
                {faces.map((p) => (
                  <span key={p.id} className="rounded-full ring-2 ring-white">
                    <Avatar name={p.name} photo={p.photo} size={20} />
                  </span>
                ))}
              </span>
              <span className="text-[12.5px] text-[var(--color-muted)]">{fmt(L.members, { n: memberCount })}</span>
            </span>
          )}
          <CompanySwitcher companies={await companyChoices(getDb(), me)} canCreateCompany={isOwnerOrAdmin(me.role)} className="hidden md:block" />
          <LangToggle className="hidden md:flex" />
          {panelHref && !showInfo && (
            <Link
              href={panelHref}
              scroll={false}
              aria-label={L.thread}
              title={L.thread}
              className={`hidden h-[34px] w-[34px] place-items-center rounded-[8px] border transition-colors lg:grid ${
                root
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              <IconPanelOpen width={16} height={16} />
            </Link>
          )}
        </header>

        <div className="scroll-thin flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-[var(--color-surface)]">
          <div className="py-3">
            {msgs.length === 0 && <p className="px-5 py-16 text-center text-[13px] text-[var(--color-faint)]">{L.empty}</p>}
            {msgs.map((m, i) => {
              const k = dayKey(m.createdAt);
              const newDay = i === 0 || dayKey(msgs[i - 1].createdAt) !== k;
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-2 flex items-center gap-3 px-5">
                      <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
                      <span className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-[11.5px] text-[var(--color-muted)]">
                        {k === today
                          ? L.today
                          : m.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep")}
                      </span>
                      <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
                    </div>
                  )}
                  <MessageRow
                    m={m}
                    names={names}
                    L={L}
                    threadHref={`/internal/${ch.id}?t=${m.parentId ?? m.id}`}
                    active={root?.id === m.id}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 md:px-5 md:pb-4">
          {canPost ? (
            <Composer
              channelId={ch.id}
              channelName={ch.name}
              people={mentionable}
              placeholder={ch.kind === "channel" ? fmt(L.msgPh, { c: ch.name }) : fmt(L.msgPhDm, { name: ch.name })}
            />
          ) : (
            <p className="rounded-[10px] bg-[var(--color-surface-2)] px-4 py-3 text-center text-[13px] text-[var(--color-muted)]">{L.onlyAdminsPost}</p>
          )}
        </div>
      </div>

      {root && (
        <aside className="flex w-full shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] lg:w-[324px]">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
            <div className="leading-tight">
              <div className="text-[14px] font-semibold text-[var(--color-ink)]">{L.thread}</div>
              <div className="text-[11.5px] text-[var(--color-faint)]">{title}</div>
            </div>
            <Link href={`/internal/${ch.id}`} scroll={false} className="text-[18px] text-[var(--color-muted)]" aria-label="Close">
              ×
            </Link>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-2">
            <MessageRow m={root} names={names} L={L} compactCard />
            <div className="mx-5 my-2 border-t border-[var(--color-border-subtle)] pt-2 text-[12px] text-[var(--color-faint)]">
              {thread.length - 1 === 1 ? L.oneReply : fmt(L.replies, { n: thread.length - 1 })}
            </div>
            {thread.slice(1).map((m) => (
              <MessageRow key={m.id} m={m} names={names} L={L} compactCard />
            ))}
          </div>
          <div className="border-t border-[var(--color-border-subtle)] p-3">
            {canPost ? (
              <Composer
                channelId={ch.id}
                channelName={ch.name}
                parentId={root.id}
                people={mentionable}
                placeholder={L.replyPh}
                thread
              />
            ) : (
              <p className="px-2 py-2 text-center text-[12.5px] text-[var(--color-muted)]">{L.onlyAdminsPost}</p>
            )}
          </div>
        </aside>
      )}

      {showInfo && (
        <ChannelInfo
          channel={{
            id: ch.id,
            name: ch.name,
            topic: ch.topic,
            icon: ch.icon,
            access: ch.access,
            permEdit: ch.permEdit,
            permPost: ch.permPost,
            permAdd: ch.permAdd,
            createdByName: ch.createdByName,
            createdAt: ch.createdAt.toISOString(),
            companyName: ch.companyName,
            channelCount: ch.channelCount,
          }}
          members={members}
          photos={Object.fromEntries(members.map((m) => [m.id, photos.get(m.id) ?? null]))}
          people={people.map((p) => ({ id: p.id, name: p.name, photo: photos.get(p.id) ?? null }))}
          events={events}
          shared={shared}
          meId={me.id}
          canManage={canManage}
          canEdit={canEdit}
          canAdd={canAdd}
          muted={ch.muted}
          closeHref={`/internal/${ch.id}`}
        />
      )}
    </div>
  );
}

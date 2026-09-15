"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { initials, relTime, tint } from "@/lib/format";
import { IconSearch } from "@/components/icons";
import { SlaTimer } from "./SlaTimer";
import { fetchConversations } from "@/app/(app)/inbox/actions";

export type ConversationListItem = {
  id: string;
  name: string;
  phone: string;
  status: string;
  unread: number;
  lastMessage: string;
  lastAt: string | null;
  /** Set only while the newest message is inbound — see fetchConversations. */
  waitingSince: string | null;
  agent: string | null;
  tags: { name: string; color: string }[];
};

const TABS = ["All", "Unread", "Open", "Closed", "Queue"] as const;

export function ConversationList({
  items,
  hasMore,
}: {
  items: ConversationListItem[];
  hasMore: boolean;
}) {
  const params = useParams();
  const activeId = params?.id as string | undefined;
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [q, setQ] = useState("");
  const [older, setOlder] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // null until the rail has paged once, so the server's answer stands until
  // then. It cannot be seeded into state: LiveRefresh re-renders this component
  // every few seconds, and a `useState(hasMore)` would freeze the first value.
  const [moreAfterPaging, setMoreAfterPaging] = useState<boolean | null>(null);

  const all = useMemo(() => {
    // Offset paging can hand back a row twice: a conversation moves up the
    // order the moment it gets a message, and one already paged in can be
    // pushed back across the offset. First copy wins, so the newest page's
    // version of a row beats the stale one held in `older`.
    const seen = new Set<string>();
    const out: ConversationListItem[] = [];
    for (const c of [...items, ...older]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [items, older]);

  const canLoadMore = moreAfterPaging ?? hasMore;

  async function loadMore() {
    setLoading(true);
    try {
      const res = await fetchConversations(all.length);
      setOlder((prev) => [...prev, ...res.items]);
      setMoreAfterPaging(res.hasMore);
    } finally {
      setLoading(false);
    }
  }

  const filtered = all.filter((c) => {
    if (q && !`${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    if (tab === "Unread") return c.unread > 0;
    if (tab === "Open") return c.status === "OPEN";
    if (tab === "Closed") return c.status === "CLOSED";
    if (tab === "Queue") return c.status === "QUEUE";
    return true;
  });

  return (
    <div className="flex w-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:w-[336px]">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
          <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or number"
            className="w-full bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
        </div>
        <div className="mt-2.5 flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                tab === t
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-[13px] text-[var(--color-faint)]">
            No conversations here.
          </p>
        )}
        {filtered.map((c) => {
          const active = c.id === activeId;
          return (
            <Link
              key={c.id}
              href={`/inbox/${c.id}`}
              className={`flex gap-3 border-b border-[var(--color-border)] px-3.5 py-3 transition-colors ${
                active
                  ? "bg-[var(--color-accent-soft)]/50"
                  : "hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <div
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: tint(c.name) }}
              >
                {initials(c.name).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--color-faint)]">
                    {relTime(c.lastAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--color-muted)]">
                  {c.lastMessage || "—"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {c.waitingSince && <SlaTimer since={c.waitingSince} />}
                  {c.tags.map((t) => (
                    <span
                      key={t.name}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `${t.color}1f`,
                        color: t.color,
                      }}
                    >
                      {t.name}
                    </span>
                  ))}
                  {c.agent && (
                    <span className="ml-auto text-[10px] text-[var(--color-faint)]">
                      {c.agent}
                    </span>
                  )}
                </div>
              </div>
              {c.unread > 0 && (
                <span className="mt-1 grid h-[18px] min-w-[18px] shrink-0 place-items-center self-start rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold text-white">
                  {c.unread}
                </span>
              )}
            </Link>
          );
        })}

        {canLoadMore && (
          <div className="p-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              title={loading ? "Loading the next page of conversations…" : undefined}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-dim)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)]"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
            {/* The filters above only ever see what is loaded, so an empty
                result is not proof the conversation does not exist. */}
            {q && (
              <p className="mt-1.5 text-center text-[10px] text-[var(--color-faint)]">
                Searching the {all.length} loaded so far.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

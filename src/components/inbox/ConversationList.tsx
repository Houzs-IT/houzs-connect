"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { initials, listTime, previewText, shortDay, tint } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { PersonAvatar } from "@/components/PersonAvatar";
import { IconClose, IconSearch } from "@/components/icons";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useShell } from "@/components/shell/ShellProvider";
import { SlaTimer, isOverdue } from "./SlaTimer";
import { fetchConversations, searchConversations } from "@/app/(app)/inbox/actions";
import { NewConversation } from "./NewConversation";

export type ConversationListItem = {
  id: string;
  name: string;
  phone: string;
  status: string;
  unread: number;
  lastMessage: string;
  /** The newest message is a picture or file (its caption, if any, is lastMessage). */
  lastMedia?: { kind: "IMAGE" | "DOCUMENT"; fileName: string | null } | null;
  lastAt: string | null;
  /** Set only while the newest message is inbound — see fetchConversations. */
  waitingSince: string | null;
  agent: string | null;
  agentId: string | null;
  /** The assignee's profile photo URL, or null. */
  agentPhoto: string | null;
  departmentId: string | null;
  department: string | null;
  tags: { id: string; name: string; color: string }[];
  watcherIds: string[];
  orderRef: string | null;
  deliveryDate: string | null;
  starred: boolean;
  lastType: string | null;
  /** A flow is waiting on this customer (automation_run `waiting`). */
  botActive: boolean;
  /** Unified inbox: the thread's company as a short label (HOUZS, 2990) — set
   *  only when the rail spans several companies (lib/inbox-group.ts). */
  companyLabel?: string | null;
  /** The thread belongs to another company than the signed-in one; opening it
   *  goes through /inbox/open/[id], which switches company first. */
  foreign?: boolean;
  /** The business number the customer wrote to (8822 service, 6133 logistics…). */
  channelPhone?: string | null;
};

type Tab = "all" | "unread" | "dept" | "sla";
type Sort = "latest" | "oldest" | "wait";
type Filters = {
  starred: boolean;
  unread: boolean;
  bot: boolean;
  sort: Sort;
  tagIds: string[];
  agentId: string;
  deptId: string;
  msgType: string;
};
const NO_FILTERS: Filters = {
  starred: false,
  unread: false,
  bot: false,
  sort: "latest",
  tagIds: [],
  agentId: "",
  deptId: "",
  msgType: "",
};

/**
 * Saved views — named filter presets, remembered per browser in localStorage.
 * They are applied on demand (from the filter popover), never on load, so there
 * is no SSR/hydration concern: the server snapshot is simply an empty list and
 * the browser fills it in after mount.
 */
export type SavedView = { name: string; filters: Filters };
const VIEWS_KEY = "hc_inbox_views";
const NO_VIEWS: SavedView[] = [];
const viewListeners = new Set<() => void>();
let viewsCache: { raw: string | null; views: SavedView[] } = { raw: null, views: NO_VIEWS };
function readViews(): SavedView[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(VIEWS_KEY);
  } catch {}
  if (raw === viewsCache.raw) return viewsCache.views;
  let views: SavedView[] = NO_VIEWS;
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      views = parsed.filter(
        (v): v is SavedView => !!v && typeof v.name === "string" && !!v.filters
      );
    }
  } catch {}
  viewsCache = { raw, views };
  return views;
}
function writeViews(views: SavedView[]) {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {}
  viewListeners.forEach((l) => l());
}
function subscribeViews(l: () => void) {
  viewListeners.add(l);
  return () => viewListeners.delete(l);
}

/**
 * The search text, held in sessionStorage and read through useSyncExternalStore
 * — like the saved views above, and for the same reason there is no hydration
 * concern: the server snapshot is an empty string and the browser fills it in.
 * Opening a thread can tear the rail down (the phone master–detail swaps panes),
 * and a half-typed search should survive that. Going through the store rather
 * than restoring into useState in an effect also avoids a set-state-in-effect.
 * It is sessionStorage, not localStorage, so a new tab starts clean.
 */
const SEARCH_KEY = "hc_inbox_search";
const searchListeners = new Set<() => void>();
function readSearch(): string {
  try {
    return sessionStorage.getItem(SEARCH_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeSearch(v: string) {
  try {
    sessionStorage.setItem(SEARCH_KEY, v);
  } catch {}
  searchListeners.forEach((l) => l());
}
function subscribeSearch(l: () => void) {
  searchListeners.add(l);
  return () => searchListeners.delete(l);
}

function activeFilterCount(f: Filters) {
  return (
    Number(f.starred) +
    Number(f.unread) +
    Number(f.bot) +
    Number(f.sort !== "latest") +
    f.tagIds.length +
    Number(!!f.agentId) +
    Number(!!f.deptId) +
    Number(!!f.msgType)
  );
}

/** Ticks every 30s — enough to move a row into "SLA overdue" on time. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ConversationList({
  items,
  hasMore,
  me,
  showOrigin = false,
}: {
  items: ConversationListItem[];
  hasMore: boolean;
  /** `memberIds`: the person's member row in every company the rail spans — in a
   *  unified inbox they are a different member in each, and "Mine" / "Watching"
   *  must count all of them. Defaults to just `id`. */
  me: { id: string; departmentId: string | null; memberIds?: string[] };
  /** The rail spans more than one number, so each row says which it came in on. */
  showOrigin?: boolean;
}) {
  const { t, compact, setCompact } = useShell();
  const myIds = useMemo(() => new Set(me.memberIds?.length ? me.memberIds : [me.id]), [me.id, me.memberIds]);
  const s = t.service;
  const params = useParams();
  const search = useSearchParams();
  const activeId = params?.id as string | undefined;
  const view = search.get("view");
  const statusParam = search.get("status");
  const tagParam = search.get("tag");
  const qs = search.toString();

  const [tab, setTab] = useState<Tab>("all");
  const [dept, setDept] = useState<string | null>(null);
  const q = useSyncExternalStore(subscribeSearch, readSearch, () => "");
  const setQ = writeSearch;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const savedViews = useSyncExternalStore(subscribeViews, readViews, () => NO_VIEWS);
  const applyView = (v: SavedView) => {
    setFilters(v.filters);
    setFilterOpen(false);
  };
  const saveView = (name: string) => {
    const n = name.trim();
    if (!n) return;
    // Replacing a same-named view updates it rather than duplicating.
    writeViews([...savedViews.filter((v) => v.name !== n), { name: n, filters }]);
  };
  const deleteView = (name: string) => writeViews(savedViews.filter((v) => v.name !== name));
  const [older, setOlder] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // null until the rail has paged once, so the server's answer stands until
  // then. It cannot be seeded into state: LiveRefresh re-renders this component
  // every few seconds, and a `useState(hasMore)` would freeze the first value.
  const [moreAfterPaging, setMoreAfterPaging] = useState<boolean | null>(null);
  const now = useNow();

  // ── Whole-book search (server) ──────────────────────────────────────────
  // The rail only holds a page, so filtering it cannot find an older/closed
  // conversation by order number. A non-empty query hits the server, which
  // searches EVERY conversation by name / phone / SO number / message text.
  const [serverHits, setServerHits] = useState<ConversationListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const searchSeq = useRef(0);
  const runSearch = useCallback(async (term: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchFailed(false);
    try {
      const res = await searchConversations(term);
      if (seq !== searchSeq.current) return; // a newer keystroke already won
      setServerHits(res.items);
      setTruncated(res.truncated);
    } catch {
      if (seq !== searchSeq.current) return;
      setServerHits([]);
      setTruncated(false);
      setSearchFailed(true); // "search failed" ≠ "no results" — say so honestly
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);
  useEffect(() => {
    const term = q.trim();
    // All state changes run in the timer callback (never synchronously in the
    // effect body): typing clears to the live list after a tick, a real term
    // searches after a debounce.
    const id = setTimeout(
      () => {
        if (!term) {
          searchSeq.current++; // drop any in-flight result
          setServerHits(null);
          setSearching(false);
          setSearchFailed(false);
          setTruncated(false);
        } else {
          void runSearch(term);
        }
      },
      term ? 250 : 0
    );
    return () => clearTimeout(id);
  }, [q, runSearch]);
  const searchActive = q.trim().length > 0;

  const toggleDensity = () => setCompact(!compact);

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

  // ── Scope: the secondary menu's view / status / tag (URL) ───────────────
  // Closed conversations only show when asked for; "All" means still open.
  const scoped = all.filter((c) => {
    if (statusParam) {
      if (c.status !== statusParam) return false;
    } else if (c.status === "CLOSED") return false;
    if (view === "mine" && !(c.agentId && myIds.has(c.agentId))) return false;
    if (view === "unassigned" && c.agentId) return false;
    if (view === "watching" && !c.watcherIds.some((id) => myIds.has(id))) return false;
    if (tagParam && !c.tags.some((tg) => tg.id === tagParam)) return false;
    return true;
  });

  // ── Popover filters (starred / unread / bot / tag / agent / dept / type) ──
  // Text search is no longer a client filter over loaded rows — it is the
  // server search above. These are the funnel-popover filters, applied to the
  // loaded rail and (when a search is active) to the server hits.
  const passesFilters = (c: ConversationListItem) => {
    if (filters.starred && !c.starred) return false;
    if (filters.unread && c.unread === 0) return false;
    if (filters.bot && !c.botActive) return false;
    if (filters.tagIds.length && !c.tags.some((tg) => filters.tagIds.includes(tg.id)))
      return false;
    if (filters.agentId && c.agentId !== filters.agentId) return false;
    if (filters.deptId && c.departmentId !== filters.deptId) return false;
    if (filters.msgType && c.lastType !== filters.msgType) return false;
    return true;
  };
  const refined = scoped.filter(passesFilters);

  // Departments present in what is loaded, for the tab's chip bar.
  const depts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const c of refined) {
      if (!c.departmentId) continue;
      const d = m.get(c.departmentId) ?? { id: c.departmentId, name: c.department ?? "—", count: 0 };
      d.count++;
      m.set(c.departmentId, d);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [refined]);
  const deptPick =
    dept && depts.some((d) => d.id === dept)
      ? dept
      : (depts.find((d) => d.id === me.departmentId)?.id ?? depts[0]?.id ?? null);

  const overdue = refined.filter((c) => isOverdue(c.waitingSince, now));
  const inDept = refined.filter((c) => c.departmentId === deptPick);
  // Opening a thread clears its unread count, so keep the open one in the tab
  // instead of having it vanish from under the cursor on the next refresh.
  const unread = refined.filter((c) => c.unread > 0 || c.id === activeId);

  let rows =
    tab === "sla" ? overdue : tab === "dept" ? inDept : tab === "unread" ? unread : refined;
  // A search replaces the tab list with whole-book hits (still subject to the
  // funnel filters), so order-number lookups find threads that were never paged.
  if (searchActive) rows = (serverHits ?? []).filter(passesFilters);
  if (filters.sort === "oldest") {
    rows = [...rows].sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""));
  } else if (filters.sort === "wait") {
    rows = [...rows].sort((a, b) => {
      if (!a.waitingSince) return 1;
      if (!b.waitingSince) return -1;
      return a.waitingSince.localeCompare(b.waitingSince);
    });
  }

  const tabs: { key: Tab; label: string; count: number; danger?: boolean }[] = [
    { key: "all", label: s.tabAll, count: refined.length },
    { key: "unread", label: s.tabUnread, count: refined.filter((c) => c.unread > 0).length },
    { key: "dept", label: s.tabDept, count: inDept.length },
    { key: "sla", label: s.tabSla, count: overdue.length, danger: true },
  ];

  const nFilters = activeFilterCount(filters);

  return (
    <div className="relative flex w-full shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:w-[320px]">
      {/* Search · density · filters */}
      <div className="flex gap-1.5 px-3 pt-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-[7px] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-accent-ring)]">
          <IconSearch width={15} height={15} className="shrink-0 text-[var(--color-faint)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={s.search}
            className="w-full min-w-0 bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              title={s.clearSearch}
              aria-label={s.clearSearch}
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
            >
              <IconClose width={13} height={13} />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={toggleDensity}
          title={compact ? s.expandedView : s.compactView}
          aria-label={compact ? s.expandedView : s.compactView}
          className="hidden h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] md:grid"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            {compact ? <path d="M3 12h18" /> : <path d="M3 9.5h18M3 14.5h18" />}
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          title={s.filters}
          aria-label={s.filters}
          aria-expanded={filterOpen}
          className={`relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] border transition-colors ${
            filterOpen || nFilters
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {nFilters > 0 && (
            <span className="absolute -right-[5px] -top-[5px] grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9.5px] font-semibold text-white shadow-[0_0_0_2px_var(--color-surface)]">
              {nFilters}
            </span>
          )}
        </button>
      </div>

      {filterOpen && (
        <FilterPopover
          items={scoped}
          value={filters}
          onChange={setFilters}
          matching={refined.length}
          onClose={() => setFilterOpen(false)}
          views={savedViews}
          onApplyView={applyView}
          onSaveView={saveView}
          onDeleteView={deleteView}
        />
      )}

      {/* All · Unread · Dept · Overdue — hidden while searching the whole book */}
      {!searchActive && (
      <div className="flex items-end gap-3 border-b border-[var(--color-border)] px-3 pt-2.5">
        {tabs.map((tb) => {
          const on = tab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-[9px] pt-1.5 text-[12.5px] font-semibold transition-colors ${
                on
                  ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              }`}
            >
              {tb.label}
              <span
                className={`rounded-full px-1.5 text-[10.5px] font-semibold leading-[17px] ${
                  tb.danger && tb.count
                    ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                    : on
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                      : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
                }`}
              >
                {tb.count}
              </span>
            </button>
          );
        })}
      </div>
      )}

      {!searchActive && tab === "dept" && depts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-border-subtle)] px-3 py-2">
          {depts.map((d) => {
            const on = d.id === deptPick;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDept(d.id)}
                className={`rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium ${
                  on
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]"
                }`}
              >
                {d.name} <span className="text-[var(--color-faint)]">{d.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Search states — "failed" is told apart from "no results" so an agent
            on weak wifi does not read a connectivity error as "doesn't exist". */}
        {searchActive && searchFailed && (
          <div className="p-6 text-center">
            <p className="text-[13px] text-[var(--color-danger)]">{s.searchFailed}</p>
            <button
              type="button"
              onClick={() => runSearch(q.trim())}
              className="mt-2 text-[12.5px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              {s.retry}
            </button>
          </div>
        )}
        {searchActive && !searchFailed && searching && rows.length === 0 && (
          <p className="p-6 text-center text-[13px] text-[var(--color-faint)]">{s.searching}</p>
        )}
        {searchActive && !searchFailed && !searching && rows.length === 0 && (
          <p className="p-6 text-center text-[13px] text-[var(--color-faint)]">
            {fmt(s.noMatches, { q: q.trim() })}
          </p>
        )}
        {!searchActive && rows.length === 0 && (
          <p className="p-6 text-center text-[13px] text-[var(--color-faint)]">{s.noConvos}</p>
        )}
        {rows.map((c) => (
          <Row
            key={c.id}
            c={c}
            // Another company's thread opens through the switch route, which
            // re-signs the session into that company and lands on the thread.
            href={`/inbox/${c.foreign ? "open/" : ""}${c.id}${qs ? `?${qs}` : ""}`}
            origin={showOrigin ? originLabel(c) : null}
            active={c.id === activeId}
            overdue={isOverdue(c.waitingSince, now)}
            compact={compact}
            deliveryLabel={s.delivery}
            yesterdayLabel={s.yesterday}
          />
        ))}

        {searchActive && truncated && rows.length > 0 && (
          <p className="px-3 py-2.5 text-center text-[10.5px] text-[var(--color-faint)]">
            {fmt(s.searchTruncated, { n: rows.length })}
          </p>
        )}

        {!searchActive && canLoadMore && (
          <div className="p-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)]"
            >
              {loading ? s.loading : s.loadMore}
            </button>
            {/* The funnel filters above only see what is loaded; an empty result
                is not proof. (Text search is whole-book, so it is exempt.) */}
            {nFilters > 0 && (
              <p className="mt-1.5 text-center text-[10.5px] text-[var(--color-faint)]">
                {fmt(s.searchingLoaded, { n: all.length })}
              </p>
            )}
          </div>
        )}
      </div>
      <NewConversation />
    </div>
  );
}

/** "8822", or "2990 · 7788" when the rail spans companies — the last digits are
 *  how the team already names its numbers. */
function originLabel(c: ConversationListItem): string | null {
  const tail = c.channelPhone ? c.channelPhone.replace(/\D/g, "").slice(-4) : "";
  const parts = [c.companyLabel, tail].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The origin chip on a row: which company / number the customer wrote to. */
function OriginChip({ label, full }: { label: string; full: string | null | undefined }) {
  return (
    <span
      title={full ?? undefined}
      className="shrink-0 whitespace-nowrap rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 text-[9.5px] font-semibold tabular-nums leading-[15px] text-[var(--color-muted)]"
    >
      {label}
    </span>
  );
}

/**
 * The row's link. Another company's thread is a plain <a>: opening it switches
 * the session cookie, and a full navigation is what makes the whole shell — top
 * bar, menu, counts — re-render as that company. A client <Link> would keep the
 * old company's layout on screen until the next refresh.
 */
function RowLink({ hard, ...props }: { hard: boolean } & ComponentProps<"a"> & { href: string }) {
  return hard ? <a {...props} /> : <Link {...props} />;
}

function Row({
  c,
  href,
  origin,
  active,
  overdue,
  compact,
  deliveryLabel,
  yesterdayLabel,
}: {
  c: ConversationListItem;
  href: string;
  origin: string | null;
  active: boolean;
  overdue: boolean;
  compact: boolean;
  deliveryLabel: string;
  yesterdayLabel: string;
}) {
  const s = useShell().t.service;
  const unread = c.unread > 0;
  const bg = active
    ? "bg-[rgba(224,239,242,0.55)]"
    : overdue
      ? "bg-[rgba(246,239,217,0.55)] hover:bg-[var(--color-surface-2)]"
      : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]";
  const time = listTime(c.lastAt, yesterdayLabel);
  const timeCls = unread
    ? "font-semibold text-[var(--color-accent)]"
    : "text-[var(--color-faint)]";

  if (compact) {
    const tag1 = c.tags[0];
    return (
      <RowLink
        hard={!!c.foreign}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`relative flex gap-2.5 border-b border-[var(--color-border-subtle)] px-3.5 py-2 transition-colors ${bg}`}
      >
        {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--color-accent)]" />}
        <Avatar name={c.name} size={30} />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)] ${unread ? "font-bold" : "font-semibold"}`}>
              {c.name}
            </span>
            {origin && <OriginChip label={origin} full={c.channelPhone} />}
            {unread && <UnreadBadge n={c.unread} small />}
            <span className={`shrink-0 text-[10.5px] ${timeCls}`}>{time}</span>
          </div>
          <p className={`truncate text-[12px] ${unread ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
            {preview(c, s)}
          </p>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px]">
            {c.orderRef && <span className="font-semibold text-[var(--color-brand)]">{c.orderRef}</span>}
            <span className="min-w-0 flex-1 truncate text-[var(--color-faint)]">{c.department}</span>
            {c.waitingSince && <SlaTimer since={c.waitingSince} compact />}
            {tag1 && (
              <span className="flex items-center gap-[3px] font-semibold" style={{ color: tag1.color }}>
                <span className="h-[5px] w-[5px] rounded-full bg-current" />
                {tag1.name}
              </span>
            )}
          </div>
        </div>
      </RowLink>
    );
  }

  return (
    <RowLink
      hard={!!c.foreign}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex gap-2.5 border-b border-[var(--color-border-subtle)] px-3.5 py-[11px] transition-colors ${bg}`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--color-accent)]" />}
      <Avatar name={c.name} size={36} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13.5px] text-[var(--color-ink)] ${unread ? "font-bold" : "font-semibold"}`}>
            {c.name}
          </span>
          {origin && <OriginChip label={origin} full={c.channelPhone} />}
          <span className={`shrink-0 text-[11px] ${timeCls}`}>{time}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className={`min-w-0 flex-1 truncate text-[12.5px] ${unread ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
            {preview(c, s)}
          </p>
          {unread && <UnreadBadge n={c.unread} />}
        </div>
        {c.orderRef && (
          <div className="mt-[3px] hidden md:flex">
            <span className="flex items-center gap-[5px] whitespace-nowrap rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[7px] py-px text-[10.5px]">
              <span className="font-semibold text-[var(--color-brand)]">{c.orderRef}</span>
              {c.deliveryDate && (
                <span className="text-[var(--color-faint)]">
                  {deliveryLabel} {shortDay(c.deliveryDate)}
                </span>
              )}
            </span>
          </div>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-1">
          {c.waitingSince && <SlaTimer since={c.waitingSince} />}
          {c.tags.map((tg) => (
            <span
              key={tg.id}
              className="shrink-0 whitespace-nowrap rounded-[4px] px-1.5 py-px text-[10px] font-medium"
              style={{ background: `${tg.color}1f`, color: tg.color }}
            >
              {tg.name}
            </span>
          ))}
          {(c.agent || c.department) && (
            <span
              title={c.agent ?? undefined}
              className="ml-auto hidden min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[10.5px] text-[var(--color-faint)] md:flex"
            >
              {c.agent && <Avatar name={c.agent} photo={c.agentPhoto} size={16} />}
              <span className="truncate">{c.department ?? c.agent}</span>
            </span>
          )}
        </div>
      </div>
    </RowLink>
  );
}

/** `photo` is for staff (the assignee); customers have none. */
function Avatar({ name, size, photo }: { name: string; size: number; photo?: string | null }) {
  return (
    <PersonAvatar name={name} photo={photo} size={size}>
      <span
        className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
        style={{
          background: tint(name),
          width: size,
          height: size,
          fontSize: size >= 36 ? 11 : size >= 30 ? 10 : 8,
        }}
      >
        {initials(name).toUpperCase()}
      </span>
    </PersonAvatar>
  );
}

function UnreadBadge({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[var(--color-accent)] font-semibold text-white ${
        small ? "h-4 min-w-4 px-1 text-[9.5px]" : "h-[18px] min-w-[18px] px-[5px] text-[10px]"
      }`}
    >
      {n}
    </span>
  );
}

/**
 * The filter popover. Everything here filters what the rail has loaded, using
 * data the rail already carries — nothing is fetched.
 */
function FilterPopover({
  items,
  value,
  onChange,
  matching,
  onClose,
  views,
  onApplyView,
  onSaveView,
  onDeleteView,
}: {
  items: ConversationListItem[];
  value: Filters;
  onChange: (f: Filters) => void;
  matching: number;
  onClose: () => void;
  views: SavedView[];
  onApplyView: (v: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (name: string) => void;
}) {
  const { t } = useShell();
  const s = t.service;
  const [viewName, setViewName] = useState("");
  const hasActive = activeFilterCount(value) > 0;
  const commitView = () => {
    if (!viewName.trim() || !hasActive) return;
    onSaveView(viewName);
    setViewName("");
  };

  const opts = useMemo(() => {
    const tags = new Map<string, { id: string; name: string; color: string }>();
    const agents = new Map<string, string>();
    const depts = new Map<string, string>();
    const types = new Set<string>();
    for (const c of items) {
      c.tags.forEach((tg) => tags.set(tg.id, tg));
      if (c.agentId && c.agent) agents.set(c.agentId, c.agent);
      if (c.departmentId && c.department) depts.set(c.departmentId, c.department);
      if (c.lastType) types.add(c.lastType);
    }
    const byName = <T extends [string, string]>(a: T, b: T) => a[1].localeCompare(b[1]);
    return {
      tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
      agents: [...agents.entries()].sort(byName),
      depts: [...depts.entries()].sort(byName),
      types: [...types].sort(),
    };
  }, [items]);

  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const chip = (on: boolean) =>
    `flex items-center gap-[5px] rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
      on
        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
        : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
    }`;
  const selectCls =
    "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute left-3 right-3 top-[54px] z-30 flex max-h-[600px] flex-col rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_2px_0_rgba(17,24,16,0.04),var(--shadow-popover)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3.5 py-3">
          <span className="text-[14px] font-semibold text-[var(--color-ink)]">{s.filters}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.shell.close}
            className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            <IconClose width={15} height={15} />
          </button>
        </div>

        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3">
          {/* Saved views — named filter presets (per browser). */}
          <div className="flex flex-col gap-[7px]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
              {s.savedViews}
            </span>
            {views.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {views.map((v) => (
                  <span
                    key={v.name}
                    className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 pl-2.5 pr-1 text-[12px] text-[var(--color-muted)]"
                  >
                    <button type="button" onClick={() => onApplyView(v)} className="max-w-[160px] truncate font-medium hover:text-[var(--color-ink)]">
                      {v.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteView(v.name)}
                      aria-label={`${s.deleteView}: ${v.name}`}
                      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[var(--color-faint)] hover:bg-[var(--color-surface-dim)] hover:text-[var(--color-danger)]"
                    >
                      <IconClose width={11} height={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitView()}
                placeholder={s.saveViewPh}
                maxLength={30}
                className={`${selectCls} flex-1`}
              />
              <button
                type="button"
                onClick={commitView}
                disabled={!viewName.trim() || !hasActive}
                title={hasActive ? undefined : s.saveViewHint}
                className="shrink-0 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {s.saveView}
              </button>
            </div>
            {!hasActive && <span className="text-[11px] text-[var(--color-faint)]">{s.saveViewHint}</span>}
          </div>

          <div className="flex flex-col gap-[7px]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
              {s.quickFilters}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={chip(value.starred)} onClick={() => set({ starred: !value.starred })}>
                ★ {s.starred}
              </button>
              <button type="button" className={chip(value.unread)} onClick={() => set({ unread: !value.unread })}>
                {s.unreadOnly}
              </button>
              <button type="button" className={chip(value.bot)} onClick={() => set({ bot: !value.bot })}>
                {s.botActive}
              </button>
            </div>
          </div>

          <Field label={s.sortBy}>
            <SearchableSelect
              className={selectCls}
              value={value.sort}
              onChange={(v) => set({ sort: v as Sort })}
              aria-label={s.sortBy}
              options={[
                { value: "latest", label: s.latest },
                { value: "oldest", label: s.oldest },
                { value: "wait", label: s.longestWait },
              ]}
            />
          </Field>

          {opts.tags.length > 0 && (
            <Field label={s.fTags}>
              <div className="flex flex-wrap gap-1">
                {opts.tags.map((tg) => {
                  const on = value.tagIds.includes(tg.id);
                  return (
                    <button
                      key={tg.id}
                      type="button"
                      onClick={() =>
                        set({
                          tagIds: on ? value.tagIds.filter((x) => x !== tg.id) : [...value.tagIds, tg.id],
                        })
                      }
                      className={`rounded-[4px] px-1.5 py-px text-[11px] font-medium ${on ? "" : "opacity-60 hover:opacity-100"}`}
                      style={{
                        background: on ? `${tg.color}26` : "var(--color-surface-2)",
                        color: on ? tg.color : "var(--color-muted)",
                      }}
                    >
                      {tg.name}
                      {on ? " ×" : ""}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label={s.fAssigned}>
            <SearchableSelect
              className={selectCls}
              value={value.agentId}
              onChange={(v) => set({ agentId: v })}
              aria-label={s.fAssigned}
              options={[
                { value: "", label: s.anyone },
                ...opts.agents.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
          </Field>

          <Field label={s.fDept}>
            <SearchableSelect
              className={selectCls}
              value={value.deptId}
              onChange={(v) => set({ deptId: v })}
              aria-label={s.fDept}
              options={[
                { value: "", label: s.anyDept },
                ...opts.depts.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
          </Field>

          <Field label={s.fMsg}>
            <SearchableSelect
              className={selectCls}
              value={value.msgType}
              onChange={(v) => set({ msgType: v })}
              aria-label={s.fMsg}
              options={[
                { value: "", label: s.anyMsg },
                ...opts.types.map((ty) => ({ value: ty, label: s.msgType[ty] ?? ty })),
              ]}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-3.5 py-2.5">
          <span className="flex-1 text-[11.5px] text-[var(--color-faint)]">{fmt(s.matching, { n: matching })}</span>
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="h-[30px] whitespace-nowrap rounded-[8px] border border-[var(--color-border)] px-3 text-[12px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            {s.reset}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[30px] whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[12px] font-semibold text-white hover:bg-[var(--color-accent-hi)]"
          >
            {s.apply}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-[var(--color-ink)]">{label}</span>
      {children}
    </div>
  );
}

/** The list's one-line preview: the text, or "Photo" / the file name for media. */
function preview(c: ConversationListItem, s: { mediaPhoto: string; mediaFile: string }): string {
  return previewText({ body: c.lastMessage, type: c.lastMedia?.kind ?? "TEXT", fileName: c.lastMedia?.fileName }, s) || "—";
}

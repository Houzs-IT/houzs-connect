import Link from "next/link";
import { PageChrome } from "@/components/PageChrome";
import { FilterPill } from "@/components/shell/FilterPill";
import { IconSearch } from "@/components/icons";
import { getCurrentMember } from "@/lib/current-member";
import { formatPhone, initials, tint } from "@/lib/format";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { isLive, phoneNumberInfo, type PhoneNumberInfo } from "@/lib/whatsapp/cloud-api";
import { shortWhen } from "@/app/(app)/contacts/queries";
import { failureReasons, logRows, statusTimeline, todayStats } from "./data";
import { LiveChip, LogsTabs } from "./LogsTabs";

// The delivery ledger: what went out, what came in, and what Meta did with it.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TZ = "Asia/Kuala_Lumpur";

const STATUS_TONE: Record<string, string> = {
  READ: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  DELIVERED: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  SENT: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  QUEUED: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  FAILED: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  RECEIVED: "bg-[var(--color-pastel-cyan)] text-[var(--color-pastel-cyan-ink)]",
};
const TYPE_TONE: Record<string, string> = {
  TEXT: "blue",
  INTERACTIVE: "orange",
  TEMPLATE: "purple",
  IMAGE: "pink",
  DOCUMENT: "cyan",
  AUDIO: "green",
  VIDEO: "pink",
};

export default async function MessageHistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.logs;
  const sp = await searchParams;
  const f = {
    q: one(sp.q).trim(),
    status: one(sp.status),
    direction: one(sp.direction),
    type: one(sp.type),
    days: ({ today: 1, "7d": 7, "30d": 30 } as Record<string, number>)[one(sp.when)] ?? null,
  };

  const [wa, stats, rows] = await Promise.all([
    phoneNumberInfo().catch(() => null),
    todayStats(me.companyId),
    logRows(me.companyId, f),
  ]);
  const reasons = await failureReasons(rows);
  const selected = rows.find((r) => r.id === one(sp.m)) ?? null;
  const timeline = selected?.waMessageId ? await statusTimeline(selected.waMessageId, selected.createdAt) : [];

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const k of ["q", "status", "direction", "type", "when"]) if (one(sp[k])) p.set(k, one(sp[k]));
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return `/logs${p.size ? `?${p}` : ""}`;
  };
  const pct = (v: number) => (stats.sent ? `${((v / stats.sent) * 100).toFixed(1)}%` : "");
  const statusOf = (r: { direction: string; status: string }) => (r.direction === "IN" ? "RECEIVED" : r.status);
  const time = (d: Date) => shortWhen(d, t.pay.yesterday);
  const cols = "grid-cols-[minmax(0,1.5fr)_minmax(0,2.1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,1fr)]";

  return (
    <PageChrome
      section="logs"
      page="messages"
      center={<LogsTabs L={L} on="messages" />}
      actions={<LiveChip live={isLive()} L={L} />}
    >
      <div className="flex flex-col gap-3.5 p-4">
        <Health info={wa} L={L} />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              [L.sentToday, stats.sent, "", "blue", "#2f5bd8"],
              [L.delivered, stats.delivered, pct(stats.delivered), "green", "#1f9d55"],
              [L.read, stats.read, pct(stats.read), "purple", "#7a4fd6"],
              [L.failed, stats.failed, pct(stats.failed), "pink", "#b23a3a"],
              [L.waitingK, stats.waiting, "", "orange", "#d9822b"],
            ] as [string, number, string, string, string][]
          ).map(([k, v, p, tone, dot]) => (
            <div
              key={k}
              className="rounded-[12px] border border-[var(--color-border)] px-3.5 py-3"
              style={{ background: `linear-gradient(135deg,#ffffff 45%, var(--color-pastel-${tone}))` }}
            >
              <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: dot }} />
                {k}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[21px] font-medium tabular-nums text-[var(--color-ink)]">{v.toLocaleString("en-US")}</span>
                {p && (
                  <span className="text-[11.5px] font-semibold" style={{ color: dot }}>
                    {p}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3.5">
          <div className="min-w-0 flex-1 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-3">
              <form className="flex h-[34px] w-full max-w-[260px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 focus-within:border-[var(--color-accent)]">
                {["status", "direction", "type", "when"].map((k) =>
                  one(sp[k]) ? <input key={k} type="hidden" name={k} value={one(sp[k])} /> : null
                )}
                <IconSearch width={14} height={14} className="text-[var(--color-faint)]" />
                <input name="q" defaultValue={f.q} placeholder={L.search} className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]" />
              </form>
              <FilterPill
                param="status"
                label={L.status}
                anyLabel={L.any}
                options={["READ", "DELIVERED", "SENT", "QUEUED", "FAILED"].map((v) => ({ value: v, label: L.st[v] }))}
              />
              <FilterPill
                param="direction"
                label={L.direction}
                anyLabel={L.any}
                options={[
                  { value: "OUT", label: L.outgoing },
                  { value: "IN", label: L.incoming },
                ]}
              />
              <FilterPill param="type" label={L.type} anyLabel={L.any} options={Object.keys(L.ty).map((v) => ({ value: v, label: L.ty[v] }))} />
              <FilterPill
                param="when"
                label={L.when}
                anyLabel={L.any}
                options={[
                  { value: "today", label: L.today },
                  { value: "7d", label: L.d7 },
                  { value: "30d", label: L.d30 },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className={`grid ${cols} gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]`}>
                  <span>{L.colCustomer}</span>
                  <span>{L.colMessage}</span>
                  <span>{L.colType}</span>
                  <span>{L.colDirection}</span>
                  <span>{L.colTime}</span>
                  <span>{L.colStatus}</span>
                </div>
                {rows.length === 0 && (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                    {f.q || f.status || f.direction || f.type || f.days ? L.noMatch : L.none}
                  </p>
                )}
                {rows.map((r) => {
                  const who = r.name || formatPhone(r.phone);
                  const c = tint(r.phone);
                  const st = statusOf(r);
                  const err = r.sendError ?? reasons.get(r.id) ?? null;
                  const tone = TYPE_TONE[r.type] ?? "blue";
                  const on = r.id === selected?.id;
                  return (
                    <Link
                      key={r.id}
                      href={keep({ m: r.id })}
                      scroll={false}
                      className={`grid ${cols} items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-2.5 last:border-b-0 ${
                        on ? "bg-[var(--color-accent-soft)]/50 shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                          style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                        >
                          {initials(who)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{who}</span>
                          <span className="block truncate text-[11.5px] tabular-nums text-[var(--color-faint)]">{formatPhone(r.phone)}</span>
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-[var(--color-ink)]">{r.body || "—"}</span>
                        {err && st === "FAILED" && <span className="block truncate text-[11.5px] text-[var(--color-danger)]">{err}</span>}
                      </span>
                      <span>
                        <span
                          className="rounded-[4px] px-1.5 py-px text-[11px] font-semibold"
                          style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                        >
                          {L.ty[r.type] ?? r.type}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-muted)]">
                        <span className={r.direction === "IN" ? "text-[var(--color-success)]" : "text-[var(--color-pastel-orange-ink)]"}>
                          {r.direction === "IN" ? "↙" : "↗"}
                        </span>
                        {r.direction === "IN" ? L.incoming : L.outgoing}
                      </span>
                      <span className="text-[12px] tabular-nums text-[var(--color-muted)]">{time(r.createdAt)}</span>
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_TONE[st] ?? STATUS_TONE.SENT}`}>
                          {L.st[st] ?? st}
                        </span>
                        {(st === "READ" || st === "DELIVERED" || st === "SENT") && <Ticks status={st} />}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="hidden w-[320px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] xl:flex">
            {!selected ? (
              <p className="p-5 text-[12.5px] text-[var(--color-faint)]">{L.selectHint}</p>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--color-border)] p-4">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                    style={{ background: `color-mix(in srgb, ${tint(selected.phone)} 14%, white)`, color: tint(selected.phone) }}
                  >
                    {initials(selected.name || selected.phone)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">{selected.name || formatPhone(selected.phone)}</div>
                    <div className="text-[12px] text-[var(--color-faint)]">
                      {L.ty[selected.type] ?? selected.type} · {selected.direction === "IN" ? L.incoming : L.outgoing}
                    </div>
                  </div>
                  <span className={`rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_TONE[statusOf(selected)]}`}>
                    {L.st[statusOf(selected)]}
                  </span>
                </div>
                <div className="scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                  <div className="rounded-[12px] bg-[#ebe4d8] p-3">
                    <div className="line-clamp-4 whitespace-pre-wrap rounded-[8px] bg-white px-3 py-2 text-[12.5px] text-[var(--color-ink)]">{selected.body || "—"}</div>
                  </div>
                  <Timeline row={selected} events={timeline} L={L} />
                  {selected.waMessageId && (
                    <div>
                      <div className="text-[11.5px] text-[var(--color-faint)]">{L.metaId}</div>
                      <div className="mt-1 break-all font-code text-[11px] text-[var(--color-ink)]">{selected.waMessageId}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
                  <Link
                    href={`/inbox/${selected.conversationId}`}
                    className="flex h-[36px] flex-1 items-center justify-center rounded-[8px] border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  >
                    {L.openConvo}
                  </Link>
                  {selected.status === "FAILED" && (
                    <button
                      type="button"
                      disabled
                      title={L.proposal}
                      className="flex h-[36px] flex-1 items-center justify-center rounded-[8px] bg-[var(--color-accent)] text-[13px] font-semibold text-white opacity-50"
                    >
                      ↻ {L.sendAgain}
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </PageChrome>
  );
}

function Ticks({ status }: { status: string }) {
  const two = status !== "SENT";
  return (
    <svg width="16" height="12" viewBox="0 0 24 16" fill="none" stroke={status === "READ" ? "#2f5bd8" : "#737c8c"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 9l4 4L14 3" />
      {two && <path d="M9 12l1 1L19 3" />}
    </svg>
  );
}

function stampTz(d: Date) {
  return d
    .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ })
    .replace(",", "");
}

function Timeline({
  row,
  events,
  L,
}: {
  row: { direction: string; status: string; waMessageId: string | null; createdAt: Date; sendError: string | null };
  events: { status: string; at: Date; code: string | null; title: string | null; detail: string | null }[];
  L: Dict["logs"];
}) {
  const steps: { icon: string; tone: string; title: string; at?: Date; note?: string; bad?: boolean }[] = [];
  if (row.direction === "IN") {
    steps.push({ icon: "↙", tone: "green", title: L.receivedAt, at: row.createdAt });
  } else if (!row.waMessageId) {
    steps.push({ icon: "!", tone: "pink", title: L.notHanded, at: row.createdAt, note: row.sendError ?? L.notHandedBody, bad: true });
  } else {
    steps.push({ icon: "↗", tone: "blue", title: L.handed, at: row.createdAt });
    for (const e of events) {
      if (e.status === "delivered") steps.push({ icon: "✓", tone: "green", title: L.deliveredAt, at: e.at });
      if (e.status === "read") steps.push({ icon: "✓", tone: "blue", title: L.readAt, at: e.at });
      if (e.status === "failed")
        steps.push({
          icon: "!",
          tone: "pink",
          title: L.failedAt,
          at: e.at,
          note: [e.code, e.title, e.detail].filter(Boolean).join(" · ") || L.failHint,
          bad: true,
        });
    }
    if (row.status === "FAILED" && !events.some((e) => e.status === "failed")) {
      steps.push({ icon: "!", tone: "pink", title: L.failedAt, note: row.sendError ?? L.failHint, bad: true });
    }
  }
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
            style={{ background: `var(--color-pastel-${s.tone})`, color: s.bad ? "var(--color-danger)" : `var(--color-pastel-${s.tone}-ink)` }}
          >
            {s.icon}
          </span>
          <div className="min-w-0">
            <div className={`text-[13px] font-semibold ${s.bad ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}`}>{s.title}</div>
            {s.at && <div className="font-code text-[11.5px] text-[var(--color-faint)]">{stampTz(s.at)}</div>}
            {s.note && <p className="mt-1.5 rounded-[8px] bg-[var(--color-danger-soft)] px-2.5 py-2 text-[12px] text-[var(--color-muted)]">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Health({ info, L }: { info: PhoneNumberInfo | null; L: Dict["logs"] }) {
  if (!info) {
    return <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] text-[var(--color-muted)]">{L.demoNote}</div>;
  }
  if (info.error) {
    return (
      <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-danger-soft)] px-4 py-3 text-[12.5px] text-[var(--color-danger)]">
        {fmt(L.metaError, { e: info.error })}
      </div>
    );
  }
  const good = (ok: boolean) => (ok ? "green" : "pink");
  const tiles: [string, string, string, string][] = [
    [L.connection, info.connection ?? "—", good(info.connection === "CONNECTED"), "⇄"],
    [L.verification, info.status ?? "—", info.status === "VERIFIED" ? "blue" : "pink", "✓"],
    [L.quality, info.qualityRating ?? "—", good(info.qualityRating === "GREEN"), "★"],
    [L.dailyLimit, (info.limitTier ?? "—").replace("TIER_", ""), "purple", "↑"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-3 pr-3 md:border-r md:border-[var(--color-border)]">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
        </span>
        <div className="leading-tight">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.sendingFrom}</div>
          <div className="text-[15px] font-semibold tabular-nums text-[var(--color-ink)]">{info.displayPhoneNumber ?? "—"}</div>
          {info.verifiedName && <div className="text-[11.5px] text-[var(--color-faint)]">{info.verifiedName}</div>}
        </div>
      </div>
      {tiles.map(([k, v, tone, icon]) => (
        <div key={k} className="flex min-w-[150px] flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2.5" style={{ background: `var(--color-pastel-${tone})` }}>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-[12px] font-bold" style={{ color: `var(--color-pastel-${tone}-ink)` }}>
            {icon}
          </span>
          <div className="leading-tight">
            <div className="text-[11px] text-[var(--color-muted)]">{k}</div>
            <div className="text-[13px] font-semibold" style={{ color: `var(--color-pastel-${tone}-ink)` }}>
              {v}
            </div>
          </div>
        </div>
      ))}
      <p className="w-[150px] text-[11px] text-[var(--color-faint)]">{L.healthNote}</p>
    </div>
  );
}

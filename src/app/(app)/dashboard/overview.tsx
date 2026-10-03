import Link from "next/link";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { Skel } from "@/components/skeleton";
import { Donut } from "./charts";
import {
  connectedAccounts,
  conversationIdsFor,
  conversationStatus,
  deliveryFollowUp,
  messageVolume,
  messagesByAgent,
  replyStats,
  teamLoad,
} from "./queries";
import { Avatar, Badge, Card, CardHead, DeltaChip, EYEBROW, Empty } from "./ui";
import { humanDuration, type PeriodWindow } from "./util";
import { VolumeCard } from "./VolumeCard";
import { SoonButton } from "./SoonButton";
import { formatPhone } from "@/lib/format";

type S = Dict["dash"];
type Props = { companyId: string; w: PeriodWindow; s: S };

// ─────────────────────── Headline metric cards ───────────────────────

function MetricCard({
  label,
  value,
  foot,
  glyph,
  tint,
}: {
  label: string;
  value: string;
  foot: React.ReactNode;
  glyph: React.ReactNode;
  tint: string;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] px-6 py-6 shadow-card"
      style={{ background: `linear-gradient(135deg, #ffffff 42%, ${tint})` }}
    >
      <div className="flex items-start justify-between">
        <div className={`${EYEBROW} text-[var(--color-accent-ink)]`}>{label}</div>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[13px] font-semibold text-[var(--color-accent-ink)] shadow-[0_1px_2px_rgba(17,24,16,0.08)]">
          {glyph}
        </span>
      </div>
      <div className="mt-3 text-[44px] font-medium leading-none tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">
        {value}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[12px] text-[var(--color-muted)]">{foot}</div>
    </section>
  );
}

export async function ReplyRateCards({ companyId, w, s }: Props) {
  const [cur, prev] = await Promise.all([
    replyStats(companyId, w.since),
    replyStats(companyId, w.prevSince, w.since),
  ]);
  const rate = cur.asked ? (cur.answered / cur.asked) * 100 : null;
  const prevRate = prev.asked ? (prev.answered / prev.asked) * 100 : null;
  const pts = rate != null && prevRate != null ? rate - prevRate : null;
  const firstDelta =
    cur.avgFirst != null && prev.avgFirst != null ? cur.avgFirst - prev.avgFirst : null;

  return (
    <>
      <MetricCard
        label={s.replyRate}
        value={rate == null ? "—" : `${rate.toFixed(1)}%`}
        glyph="%"
        tint="#d9eef4"
        foot={
          <>
            {s.vsPrev}
            {pts != null && (
              <DeltaChip text={`${Math.abs(pts).toFixed(1)} ${s.pts}`} up={pts >= 0} />
            )}
          </>
        }
      />
      <MetricCard
        label={s.firstReply}
        value={cur.avgFirst == null ? "—" : humanDuration(cur.avgFirst)}
        tint="#e4e6fb"
        glyph={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        }
        foot={
          <>
            {fmt(s.measured, { n: cur.answered })}
            {firstDelta != null && Math.round(firstDelta) !== 0 && (
              // Faster is better: a negative change is the good one.
              <DeltaChip text={humanDuration(Math.abs(firstDelta))} up={firstDelta > 0} />
            )}
          </>
        }
      />
    </>
  );
}

export function ReplyRateSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <section key={i} className="rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-6">
          <Skel className="h-[12px] w-24" />
          <Skel className="mt-4 h-[44px] w-40" />
          <Skel className="mt-4 h-[18px] w-36" />
        </section>
      ))}
    </>
  );
}

// ─────────────────────── Delivery follow-up ───────────────────────

export async function FollowUpCard({ companyId, w, s }: Props) {
  const f = await deliveryFollowUp(companyId, w);
  if (!f) {
    return (
      <Card className="h-full">
        <CardHead title={s.followup} />
        <Empty>{s.noFollowup}</Empty>
      </Card>
    );
  }
  const links = await conversationIdsFor(f.stale.map((x) => x.contactId));
  const pct = f.notified ? Math.round((f.confirmed / f.notified) * 100) : 0;
  const chip = (n: number, label: string) => (
    <span className="rounded-full border border-[var(--color-border)] px-2.5 py-[3px] text-[12px] text-[var(--color-muted)]">
      <b className="font-semibold text-[var(--color-ink)]">{n}</b> {label}
    </span>
  );
  return (
    <Card className="h-full">
      <CardHead
        title={s.followup}
        sub={fmt(s.followupSub, { name: f.name })}
        action={
          <Link href={`/automations/${f.automationId}`} className="text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
            {s.manage} ↗
          </Link>
        }
      />
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          [f.notified, s.notified, "text-[var(--color-ink)]"],
          [f.confirmed, s.confirmed, "text-[var(--color-ink)]"],
          [f.noReply, s.noReply, "text-[var(--color-brand)]"],
        ].map(([v, l, c]) => (
          <div key={l as string}>
            <div className={`text-[30px] font-medium leading-none tracking-[-0.02em] tabular-nums ${c}`}>{v}</div>
            <div className="mt-1.5 text-[11.5px] text-[var(--color-faint)]">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between text-[12px] text-[var(--color-ink)]">
        <span>{s.confirmRate}</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[#4fb0c6]" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {chip(f.rescheduled, s.rescheduled)}
        {chip(f.delivered, s.delivered)}
        {chip(f.issue, s.issue)}
        {chip(f.receipts, s.receipts)}
      </div>
      {f.stale.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-warning)]">
            ⚠ {s.needs}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-[var(--color-muted)]">{s.needsSub}</p>
          <ul className="mt-2 flex flex-col">
            {f.stale.map((x) => {
              const href = links.get(x.contactId);
              const row = (
                <>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand-bright)]" />
                  {x.ref && <span className="font-semibold text-[var(--color-brand)]">{x.ref}</span>}
                  <span className="min-w-0 flex-1 truncate text-[var(--color-muted)]">
                    {x.name}
                    {x.sales ? ` · ${x.sales}` : ""}
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--color-danger)]">{x.hours}h</span>
                  <span className="text-[var(--color-faint)]">↗</span>
                </>
              );
              return (
                <li key={x.contactId}>
                  {href ? (
                    <Link href={`/inbox/${href}`} className="flex items-center gap-2 rounded-[6px] py-1.5 text-[12.5px] hover:bg-[var(--color-surface-2)]">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 py-1.5 text-[12.5px]">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────── AI (coming soon) ───────────────────────

/** Proposal card, shown as the design shows it: disabled, marked Coming soon. */
export function AiCard({ s }: { s: S }) {
  return (
    <section
      className="relative overflow-hidden rounded-[16px] px-[22px] py-5 text-white shadow-[var(--shadow-modal)]"
      style={{
        background:
          "radial-gradient(120% 90% at 85% 0%, rgba(103,190,214,0.28), transparent 55%), linear-gradient(160deg,#1a2744 0%,#111a30 50%,#0b1020 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.55) 0.7px, transparent 0.7px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c9d3e3]">✦ {s.ai}</span>
          <span className="rounded-full border border-[rgba(103,190,214,0.5)] bg-[rgba(30,111,128,0.35)] px-2 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[#bfe6ef]">
            {s.soon}
          </span>
        </div>
        <div className="mt-3 text-[24px] font-semibold tracking-[-0.01em]">{s.askTitle}</div>
        <p className="mt-2 text-[12.5px] text-[#c9d3e3]">{s.askSub}</p>
        <div className="mt-4 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-3 text-[12.5px] text-[#8590a6]">
          {s.askPh}
        </div>
        <button
          type="button"
          disabled
          title={s.soon}
          className="mt-3 flex h-[38px] w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] text-[13px] font-semibold text-white opacity-80"
        >
          {s.send}
        </button>
      </div>
    </section>
  );
}

// ─────────────────────── Conversations donut ───────────────────────

const STATUS_COLOR: Record<string, string> = {
  CLOSED: "var(--color-accent)",
  OPEN: "#4fb0c6",
  PENDING: "var(--color-brand-bright)",
  QUEUE: "var(--color-danger)",
};

export async function ConversationsCard({ companyId, w, s }: Props) {
  const { total, by } = await conversationStatus(companyId, w);
  const order = ["CLOSED", "OPEN", "PENDING", "QUEUE"];
  const pct = (k: string) => (total ? ((by[k] ?? 0) / total) * 100 : 0);
  return (
    <Card>
      <CardHead
        title={s.convos}
        sub={s.convosSub}
        action={<span className="text-[12px] tabular-nums text-[var(--color-faint)]">{total}</span>}
      />
      {total === 0 ? (
        <Empty>{s.noData}</Empty>
      ) : (
        <div className="flex items-center gap-6">
          <Donut
            segments={order.map((k) => ({ value: by[k] ?? 0, color: STATUS_COLOR[k] }))}
            center={`${Math.round(pct("CLOSED"))}%`}
            caption={s.closedShare}
          />
          <ul className="flex min-w-0 flex-1 flex-col gap-2.5 text-[12.5px]">
            {order.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[k] }} />
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{s.status[k]}</span>
                <span className="w-12 text-right font-semibold tabular-nums" style={{ color: STATUS_COLOR[k] }}>
                  {pct(k).toFixed(1)}%
                </span>
                <span className="w-9 text-right tabular-nums text-[var(--color-faint)]">{by[k] ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────── Message volume ───────────────────────

export async function VolumeSection({ companyId, w }: Omit<Props, "s">) {
  const [vol, agents, cur, prev] = await Promise.all([
    messageVolume(companyId, w),
    messagesByAgent(companyId, w),
    replyStats(companyId, w.since),
    replyStats(companyId, w.prevSince, w.since),
  ]);
  const rate = cur.asked ? (cur.answered / cur.asked) * 100 : null;
  const prevRate = prev.asked ? (prev.answered / prev.asked) * 100 : null;
  return (
    <VolumeCard
      labels={w.buckets.map((b) => b.label)}
      inbound={vol.series.map((d) => d.inbound)}
      outbound={vol.series.map((d) => d.outbound)}
      totals={vol.total}
      prev={vol.prev}
      rate={rate}
      ratePts={rate != null && prevRate != null ? rate - prevRate : null}
      agents={agents}
    />
  );
}

// ─────────────────────── Right column ───────────────────────

export async function TeamCard({ companyId, w, s }: Props) {
  const rows = await teamLoad(companyId, w);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card>
      <CardHead
        title={s.team}
        sub={s.teamSub}
        action={
          <Link href="?tab=support" className="text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
            {s.seeAll} ↗
          </Link>
        }
      />
      {rows.length === 0 ? (
        <Empty>{s.noData}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-2.5">
              <Avatar name={r.name} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-[var(--color-ink)]">{r.name}</span>
                  <span className="tabular-nums text-[var(--color-muted)]">{r.n}</span>
                </div>
                <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[#4fb0c6]"
                    style={{ width: `${(r.n / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Proposal card: a per-agent scored workbook. Not built yet — the button says so. */
export function ReportCard({ s }: { s: S }) {
  return (
    <Card>
      <div className={EYEBROW}>▤ {s.report}</div>
      <p className="mt-2 text-[12px] leading-snug text-[var(--color-faint)]">{s.reportSub}</p>
      <SoonButton label={`↻ ${s.generate}`} note={s.soonNote} />
    </Card>
  );
}

export async function AccountsCard({ companyId, s }: { companyId: string; s: S }) {
  const a = await connectedAccounts(companyId);
  const connected = (a.numbers.length > 0 ? 1 : 0) + (a.erpSynced ? 1 : 0) + (a.driverToday > 0 ? 1 : 0);
  const total = 4;
  const integration = (
    mark: string,
    name: string,
    status: string,
    on: boolean,
    href: string,
    primary = false
  ) => (
    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[var(--color-border)] bg-white text-[9.5px] font-bold text-[var(--color-brand)]">
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--color-ink)]">{name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-faint)]">
          <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-[var(--color-success)]" : "bg-[var(--color-border-strong)]"}`} />
          <span className="truncate">{status}</span>
        </div>
      </div>
      <Link
        href={href}
        className={
          primary
            ? "flex h-[30px] items-center rounded-[8px] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
            : "flex h-[30px] items-center rounded-[8px] border border-[var(--color-border)] bg-white px-3 text-[12px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)]"
        }
      >
        {primary ? s.connect : s.settings}
      </Link>
    </div>
  );
  return (
    <Card>
      <CardHead title={s.connected} action={<span className="text-[12px] tabular-nums text-[var(--color-faint)]">{connected}/{total}</span>} />
      <div className="h-[3px] overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="h-full bg-[var(--color-accent)]" style={{ width: `${(connected / total) * 100}%` }} />
      </div>
      <div className={`mt-4 ${EYEBROW}`}>{s.whatsapp}</div>
      <div className="mt-2 flex flex-col gap-2">
        {a.numbers.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          a.numbers.map((n) => (
            <Link
              key={n.id}
              href="/settings/numbers"
              className="flex items-center gap-3 rounded-[12px] border border-[var(--color-border)] px-3.5 py-3 hover:bg-[var(--color-surface-2)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium tabular-nums text-[var(--color-ink)]">{formatPhone(n.phone)}</div>
                <div className="truncate text-[11.5px] text-[var(--color-faint)]">{n.displayName || a.companyName}</div>
              </div>
              <Badge tone={a.live && n.phoneNumberId ? "success" : "neutral"}>{a.live && n.phoneNumberId ? "Live" : "Demo"}</Badge>
            </Link>
          ))
        )}
      </div>
      <div className={`mt-4 ${EYEBROW}`}>{s.integrations}</div>
      <div className="mt-2 flex flex-col gap-2">
        {integration("HC", s.erp, a.erpSynced ? s.erpOn : s.erpOff, a.erpSynced, "/settings/team")}
        {integration("TMS", s.driver, fmt(s.driverEvents, { n: a.driverToday }), a.driverToday > 0, "/logs/webhooks")}
        {integration("OCR", s.ocr, s.ocrOff, false, "/payments", true)}
      </div>
    </Card>
  );
}

/** Generic card-sized placeholder for streamed sections. */
export function CardSkeleton({ h = 220 }: { h?: number }) {
  return (
    <Card>
      <Skel className="h-[12px] w-28" />
      <Skel className="mt-2 h-[11px] w-44" />
      <div className="skeleton mt-4 rounded-[10px]" style={{ height: h - 70 }} />
    </Card>
  );
}
